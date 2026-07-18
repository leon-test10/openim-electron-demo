export type CollaborationRole = "driver" | "worker" | "reviewer" | "observer";
export type CollaborationParticipantKind = "human" | "agent";
export type CollaborationStatus =
  | "planning"
  | "running"
  | "reviewing"
  | "waiting_human"
  | "completed"
  | "failed"
  | "aborted";
export type CollaborationTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface CollaborationParticipant {
  participantID: string;
  kind: CollaborationParticipantKind;
  principalID: string;
  displayName: string;
  role: CollaborationRole;
  agentID?: string;
}

export interface CollaborationTask {
  taskID: string;
  collaborationID: string;
  delegationKey: string;
  title: string;
  instruction: string;
  risk: "low" | "medium" | "high";
  assigneeParticipantID: string;
  dependsOnTaskIDs: string[];
  status: CollaborationTaskStatus;
  runID?: string;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HumanIntervention {
  requestID: string;
  requestedByParticipantID: string;
  reason: string;
  risk: "medium" | "high";
  pendingAction?: Record<string, unknown>;
  previousStatus: CollaborationStatus;
  requestedAt: number;
  resolvedAt?: number;
  resolvedByParticipantID?: string;
  decision?: "approve" | "reject" | "instruct";
  instruction?: string;
}

export interface CollaborationSession {
  collaborationID: string;
  conversationID: string;
  sessionID: string;
  idempotencyKey: string;
  objective: string;
  status: CollaborationStatus;
  participants: CollaborationParticipant[];
  tasks: CollaborationTask[];
  intervention?: HumanIntervention;
  finalSummary?: string;
  createdAt: number;
  updatedAt: number;
  lastSequence: number;
}

export type CollaborationEventType =
  | "collaboration.created"
  | "tasks.delegated"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "review.started"
  | "review.approved"
  | "review.revision_requested"
  | "human.requested"
  | "human.resolved"
  | "collaboration.completed"
  | "collaboration.aborted";

export interface CollaborationEvent {
  eventID: string;
  collaborationID: string;
  sequence: number;
  type: CollaborationEventType;
  actorParticipantID: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CollaborationSnapshot {
  version: 1;
  sessions: CollaborationSession[];
  events: CollaborationEvent[];
}

export interface CollaborationStateStore {
  load(): Promise<CollaborationSnapshot | undefined>;
  save(snapshot: CollaborationSnapshot): Promise<void>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as unknown as T;

export class InMemoryCollaborationStateStore implements CollaborationStateStore {
  snapshot?: CollaborationSnapshot;

  load() {
    return Promise.resolve(this.snapshot ? clone(this.snapshot) : undefined);
  }

  save(snapshot: CollaborationSnapshot) {
    this.snapshot = clone(snapshot);
    return Promise.resolve();
  }
}

export interface CollaborationEngineOptions {
  now?: () => number;
  createID?: () => string;
}

export type CollaborationEventListener = (event: CollaborationEvent) => void;

const requireText = (value: string, name: string) => {
  if (!value.trim()) throw new Error(`${name} is required`);
};
const participantKinds: readonly CollaborationParticipantKind[] = ["human", "agent"];
const collaborationRoles: readonly CollaborationRole[] = [
  "driver",
  "worker",
  "reviewer",
  "observer",
];

export class AgentCollaborationEngine {
  private readonly sessions = new Map<string, CollaborationSession>();
  private readonly events = new Map<string, CollaborationEvent[]>();
  private readonly sessionByIdempotency = new Map<string, string>();
  private readonly listeners = new Set<CollaborationEventListener>();
  private readonly pendingEvents: CollaborationEvent[] = [];
  private readonly now: () => number;
  private readonly createID: () => string;
  private initialization?: Promise<void>;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: CollaborationStateStore,
    options: CollaborationEngineOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createID =
      options.createID ??
      (() =>
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  initialize() {
    this.initialization ??= this.restore();
    return this.initialization;
  }

  subscribe(listener: CollaborationEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createCollaboration(params: {
    conversationID: string;
    sessionID: string;
    idempotencyKey: string;
    objective: string;
    participants: CollaborationParticipant[];
  }) {
    return this.transact(async () => {
      requireText(params.conversationID, "conversationID");
      requireText(params.sessionID, "sessionID");
      requireText(params.idempotencyKey, "idempotencyKey");
      requireText(params.objective, "objective");
      const scope = `${params.conversationID}:${params.idempotencyKey}`;
      const existingID = this.sessionByIdempotency.get(scope);
      if (existingID) {
        return {
          created: false,
          collaboration: clone(this.sessions.get(existingID)!),
        };
      }
      this.validateParticipants(params.participants);
      const timestamp = this.now();
      const collaboration: CollaborationSession = {
        collaborationID: this.createID(),
        conversationID: params.conversationID,
        sessionID: params.sessionID,
        idempotencyKey: params.idempotencyKey,
        objective: params.objective,
        status: "planning",
        participants: clone(params.participants),
        tasks: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSequence: -1,
      };
      this.sessions.set(collaboration.collaborationID, collaboration);
      this.sessionByIdempotency.set(scope, collaboration.collaborationID);
      this.appendEvent(
        collaboration,
        "collaboration.created",
        this.driver(collaboration).participantID,
        { objective: collaboration.objective },
      );
      await this.persist();
      return { created: true, collaboration: clone(collaboration) };
    });
  }

  async delegateTasks(params: {
    collaborationID: string;
    driverParticipantID: string;
    delegationKey: string;
    tasks: Array<{
      taskID?: string;
      title: string;
      instruction: string;
      risk?: "low" | "medium" | "high";
      assigneeParticipantID: string;
      dependsOnTaskIDs?: string[];
    }>;
  }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      this.requireRole(collaboration, params.driverParticipantID, "driver");
      requireText(params.delegationKey, "delegationKey");
      const existing = collaboration.tasks.filter(
        (task) => task.delegationKey === params.delegationKey,
      );
      if (existing.length > 0) {
        return { created: false, tasks: clone(existing) };
      }
      if (params.tasks.length === 0) throw new Error("Delegation requires tasks");
      const timestamp = this.now();
      const created = params.tasks.map((task) => {
        requireText(task.title, "task title");
        requireText(task.instruction, "task instruction");
        const assignee = this.requireParticipant(
          collaboration,
          task.assigneeParticipantID,
        );
        if (assignee.role !== "worker") {
          throw new Error(`Delegated task assignee must be a worker`);
        }
        return {
          taskID: task.taskID ?? this.createID(),
          collaborationID: collaboration.collaborationID,
          delegationKey: params.delegationKey,
          title: task.title,
          instruction: task.instruction,
          risk: task.risk ?? "medium",
          assigneeParticipantID: task.assigneeParticipantID,
          dependsOnTaskIDs: [...(task.dependsOnTaskIDs ?? [])],
          status: "queued" as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });
      const allTasks = [...collaboration.tasks, ...created];
      this.validateTaskGraph(allTasks);
      collaboration.tasks.push(...created);
      collaboration.status = "running";
      collaboration.updatedAt = timestamp;
      this.appendEvent(collaboration, "tasks.delegated", params.driverParticipantID, {
        taskIDs: created.map((task) => task.taskID),
      });
      await this.persist();
      return { created: true, tasks: clone(created) };
    });
  }

  listReadyTasks(collaborationID: string) {
    const collaboration = this.requireSession(collaborationID);
    const byID = new Map(
      collaboration.tasks.map((task) => [task.taskID, task] as const),
    );
    return collaboration.tasks
      .filter(
        (task) =>
          task.status === "queued" &&
          task.dependsOnTaskIDs.every(
            (dependencyID) => byID.get(dependencyID)?.status === "completed",
          ),
      )
      .map((task) => clone(task));
  }

  async startTask(params: {
    collaborationID: string;
    taskID: string;
    assigneeParticipantID: string;
    runID: string;
  }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      const task = this.requireTask(collaboration, params.taskID);
      if (task.assigneeParticipantID !== params.assigneeParticipantID) {
        throw new Error("Only the assigned participant can start a task");
      }
      if (
        !this.listReadyTasks(collaboration.collaborationID).some(
          (ready) => ready.taskID === task.taskID,
        )
      ) {
        throw new Error(`Task is not ready: ${task.taskID}`);
      }
      task.status = "running";
      task.runID = params.runID;
      task.updatedAt = this.now();
      collaboration.updatedAt = task.updatedAt;
      this.appendEvent(collaboration, "task.started", params.assigneeParticipantID, {
        taskID: task.taskID,
        runID: task.runID,
      });
      await this.persist();
      return clone(task);
    });
  }

  async completeTask(params: {
    collaborationID: string;
    taskID: string;
    assigneeParticipantID: string;
    output: Record<string, unknown>;
  }) {
    return this.settleTask(params, "completed");
  }

  async failTask(params: {
    collaborationID: string;
    taskID: string;
    assigneeParticipantID: string;
    error: string;
  }) {
    return this.settleTask(params, "failed");
  }

  async beginReview(params: { collaborationID: string; driverParticipantID: string }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      this.requireRole(collaboration, params.driverParticipantID, "driver");
      const workers = collaboration.tasks.filter((task) =>
        this.hasRole(collaboration, task.assigneeParticipantID, "worker"),
      );
      if (workers.length === 0 || workers.some((task) => task.status !== "completed")) {
        throw new Error("All worker tasks must complete before review");
      }
      const reviewer = collaboration.participants.find(
        (participant) => participant.role === "reviewer",
      );
      if (!reviewer) {
        throw new Error("Collaboration has no reviewer");
      }
      const reviewTasks = collaboration.tasks.filter((task) =>
        task.delegationKey.startsWith("system:review:"),
      );
      const existing = reviewTasks.find(
        (task) => task.status === "queued" || task.status === "running",
      );
      if (existing) return clone(existing);
      const timestamp = this.now();
      const reviewTask: CollaborationTask = {
        taskID: this.createID(),
        collaborationID: collaboration.collaborationID,
        delegationKey: `system:review:${reviewTasks.length + 1}`,
        title: "Review aggregated worker outputs",
        instruction: "Review correctness, completeness, risks, and deliverables.",
        risk: "medium",
        assigneeParticipantID: reviewer.participantID,
        dependsOnTaskIDs: workers.map((task) => task.taskID),
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      collaboration.tasks.push(reviewTask);
      collaboration.status = "reviewing";
      collaboration.updatedAt = timestamp;
      this.appendEvent(collaboration, "review.started", params.driverParticipantID, {
        taskID: reviewTask.taskID,
        workerOutputs: workers.map((task) => ({
          taskID: task.taskID,
          output: task.output,
        })),
      });
      await this.persist();
      return clone(reviewTask);
    });
  }

  async submitReview(params: {
    collaborationID: string;
    reviewTaskID: string;
    reviewerParticipantID: string;
    decision: "approve" | "revise";
    feedback: string;
    finalSummary?: string;
  }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      this.requireRole(collaboration, params.reviewerParticipantID, "reviewer");
      const task = this.requireTask(collaboration, params.reviewTaskID);
      if (task.assigneeParticipantID !== params.reviewerParticipantID) {
        throw new Error("Review task is assigned to another reviewer");
      }
      if (task.status !== "queued" && task.status !== "running") {
        throw new Error("Review task is already settled");
      }
      task.status = "completed";
      task.output = { decision: params.decision, feedback: params.feedback };
      task.updatedAt = this.now();
      collaboration.updatedAt = task.updatedAt;
      if (params.decision === "approve") {
        collaboration.status = "completed";
        collaboration.finalSummary = params.finalSummary ?? params.feedback;
        this.appendEvent(
          collaboration,
          "review.approved",
          params.reviewerParticipantID,
          { taskID: task.taskID, feedback: params.feedback },
        );
        this.appendEvent(
          collaboration,
          "collaboration.completed",
          params.reviewerParticipantID,
          { finalSummary: collaboration.finalSummary },
        );
      } else {
        collaboration.status = "running";
        this.appendEvent(
          collaboration,
          "review.revision_requested",
          params.reviewerParticipantID,
          { taskID: task.taskID, feedback: params.feedback },
        );
      }
      await this.persist();
      return clone(collaboration);
    });
  }

  async requestHumanIntervention(params: {
    collaborationID: string;
    requestedByParticipantID: string;
    reason: string;
    risk: "medium" | "high";
    pendingAction?: Record<string, unknown>;
  }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      this.requireParticipant(collaboration, params.requestedByParticipantID);
      requireText(params.reason, "intervention reason");
      if (collaboration.intervention && !collaboration.intervention.resolvedAt) {
        return clone(collaboration.intervention);
      }
      const intervention: HumanIntervention = {
        requestID: this.createID(),
        requestedByParticipantID: params.requestedByParticipantID,
        reason: params.reason,
        risk: params.risk,
        pendingAction: params.pendingAction,
        previousStatus: collaboration.status,
        requestedAt: this.now(),
      };
      collaboration.intervention = intervention;
      collaboration.status = "waiting_human";
      collaboration.updatedAt = intervention.requestedAt;
      this.appendEvent(
        collaboration,
        "human.requested",
        params.requestedByParticipantID,
        {
          requestID: intervention.requestID,
          reason: intervention.reason,
          risk: intervention.risk,
        },
      );
      await this.persist();
      return clone(intervention);
    });
  }

  async resolveHumanIntervention(params: {
    collaborationID: string;
    humanParticipantID: string;
    decision: "approve" | "reject" | "instruct";
    instruction?: string;
  }) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      const human = this.requireParticipant(collaboration, params.humanParticipantID);
      if (human.kind !== "human") {
        throw new Error("Only a human participant can resolve intervention");
      }
      const intervention = collaboration.intervention;
      if (!intervention || intervention.resolvedAt) {
        throw new Error("No pending human intervention");
      }
      if (params.decision === "instruct" && !params.instruction?.trim()) {
        throw new Error("Human instruction is required");
      }
      intervention.resolvedAt = this.now();
      intervention.resolvedByParticipantID = human.participantID;
      intervention.decision = params.decision;
      intervention.instruction = params.instruction;
      const reviewTaskID =
        intervention.pendingAction?.type === "review.finalize" &&
        typeof intervention.pendingAction.reviewTaskID === "string"
          ? intervention.pendingAction.reviewTaskID
          : undefined;
      const reviewTask = reviewTaskID
        ? this.requireTask(collaboration, reviewTaskID)
        : undefined;
      const recommendation =
        intervention.pendingAction?.recommendation &&
        typeof intervention.pendingAction.recommendation === "object" &&
        !Array.isArray(intervention.pendingAction.recommendation)
          ? (intervention.pendingAction.recommendation as Record<string, unknown>)
          : {};
      if (reviewTask && params.decision !== "reject") {
        reviewTask.status = "completed";
        reviewTask.output = {
          ...recommendation,
          humanDecision: params.decision,
          humanInstruction: params.instruction,
        };
        reviewTask.updatedAt = intervention.resolvedAt;
        if (params.decision === "approve") {
          collaboration.status = "completed";
          collaboration.finalSummary =
            params.instruction?.trim() ||
            (typeof recommendation.finalSummary === "string"
              ? recommendation.finalSummary
              : typeof recommendation.text === "string"
              ? recommendation.text
              : typeof recommendation.summary === "string"
              ? recommendation.summary
              : "Human-approved collaboration result");
        } else {
          collaboration.status = "running";
          const worker = collaboration.participants.find(
            (participant) => participant.role === "worker",
          );
          if (!worker) throw new Error("Collaboration has no worker for revision");
          const revisionTask: CollaborationTask = {
            taskID: this.createID(),
            collaborationID: collaboration.collaborationID,
            delegationKey: `human:revision:${intervention.requestID}`,
            title: "Human-requested revision",
            instruction: params.instruction!.trim(),
            risk: "medium",
            assigneeParticipantID: worker.participantID,
            dependsOnTaskIDs: collaboration.tasks
              .filter((task) =>
                this.hasRole(collaboration, task.assigneeParticipantID, "worker"),
              )
              .map((task) => task.taskID),
            status: "queued",
            createdAt: intervention.resolvedAt,
            updatedAt: intervention.resolvedAt,
          };
          collaboration.tasks.push(revisionTask);
          this.validateTaskGraph(collaboration.tasks);
          this.appendEvent(collaboration, "tasks.delegated", human.participantID, {
            taskIDs: [revisionTask.taskID],
            source: "human.revision",
          });
        }
      } else {
        collaboration.status =
          params.decision === "reject"
            ? "aborted"
            : intervention.previousStatus === "waiting_human"
            ? "running"
            : intervention.previousStatus;
      }
      collaboration.updatedAt = intervention.resolvedAt;
      this.appendEvent(collaboration, "human.resolved", human.participantID, {
        requestID: intervention.requestID,
        decision: params.decision,
        instruction: params.instruction,
      });
      if (reviewTask && params.decision === "approve") {
        this.appendEvent(collaboration, "review.approved", human.participantID, {
          taskID: reviewTask.taskID,
          feedback: params.instruction,
          recommendation,
        });
        this.appendEvent(
          collaboration,
          "collaboration.completed",
          human.participantID,
          {
            finalSummary: collaboration.finalSummary,
          },
        );
      } else if (reviewTask && params.decision === "instruct") {
        this.appendEvent(
          collaboration,
          "review.revision_requested",
          human.participantID,
          {
            taskID: reviewTask.taskID,
            feedback: params.instruction,
            recommendation,
          },
        );
      } else if (params.decision === "reject") {
        this.appendEvent(collaboration, "collaboration.aborted", human.participantID, {
          reason: intervention.reason,
        });
      }
      await this.persist();
      return clone(collaboration);
    });
  }

  getCollaboration(collaborationID: string) {
    const collaboration = this.sessions.get(collaborationID);
    return collaboration ? clone(collaboration) : undefined;
  }

  listByConversation(conversationID: string) {
    return [...this.sessions.values()]
      .filter((session) => session.conversationID === conversationID)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => clone(session));
  }

  listEvents(collaborationID: string, afterSequence = -1) {
    return (this.events.get(collaborationID) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map((event) => clone(event));
  }

  snapshot(): CollaborationSnapshot {
    return {
      version: 1,
      sessions: [...this.sessions.values()].map((session) => clone(session)),
      events: [...this.events.values()].flat().map((event) => clone(event)),
    };
  }

  private async settleTask(
    params: {
      collaborationID: string;
      taskID: string;
      assigneeParticipantID: string;
      output?: Record<string, unknown>;
      error?: string;
    },
    status: "completed" | "failed",
  ) {
    return this.transact(async () => {
      const collaboration = this.requireSession(params.collaborationID);
      this.requireOperational(collaboration);
      const task = this.requireTask(collaboration, params.taskID);
      if (
        status === "completed" &&
        this.hasRole(collaboration, task.assigneeParticipantID, "reviewer")
      ) {
        throw new Error("Reviewer tasks must be settled through submitReview");
      }
      if (task.assigneeParticipantID !== params.assigneeParticipantID) {
        throw new Error("Only the assigned participant can settle a task");
      }
      if (task.status !== "running") throw new Error("Task is not running");
      task.status = status;
      task.output = params.output;
      task.error = params.error;
      task.updatedAt = this.now();
      collaboration.updatedAt = task.updatedAt;
      if (status === "failed") collaboration.status = "failed";
      this.appendEvent(
        collaboration,
        status === "completed" ? "task.completed" : "task.failed",
        params.assigneeParticipantID,
        { taskID: task.taskID, output: task.output, error: task.error },
      );
      await this.persist();
      return clone(task);
    });
  }

  private appendEvent(
    collaboration: CollaborationSession,
    type: CollaborationEventType,
    actorParticipantID: string,
    payload: Record<string, unknown>,
  ) {
    const event: CollaborationEvent = {
      eventID: this.createID(),
      collaborationID: collaboration.collaborationID,
      sequence: collaboration.lastSequence + 1,
      type,
      actorParticipantID,
      payload,
      createdAt: this.now(),
    };
    collaboration.lastSequence = event.sequence;
    const events = this.events.get(collaboration.collaborationID) ?? [];
    events.push(event);
    this.events.set(collaboration.collaborationID, events);
    this.pendingEvents.push(clone(event));
    return event;
  }

  private validateParticipants(participants: CollaborationParticipant[]) {
    const ids = new Set<string>();
    participants.forEach((participant) => {
      requireText(participant.participantID, "participantID");
      requireText(participant.principalID, "principalID");
      requireText(participant.displayName, "participant displayName");
      if (!participantKinds.includes(participant.kind)) {
        throw new Error(`Unsupported participant kind: ${String(participant.kind)}`);
      }
      if (!collaborationRoles.includes(participant.role)) {
        throw new Error(`Unsupported collaboration role: ${String(participant.role)}`);
      }
      if (ids.has(participant.participantID)) {
        throw new Error(`Duplicate participant: ${participant.participantID}`);
      }
      ids.add(participant.participantID);
      if (participant.kind === "agent" && !participant.agentID) {
        throw new Error(`Agent participant requires agentID`);
      }
    });
    if (
      participants.filter((participant) => participant.role === "driver").length !== 1
    ) {
      throw new Error("Collaboration requires exactly one driver");
    }
    if (!participants.some((participant) => participant.role === "worker")) {
      throw new Error("Collaboration requires at least one worker");
    }
    if (!participants.some((participant) => participant.kind === "human")) {
      throw new Error("Collaboration requires a human governance participant");
    }
  }

  private validateTaskGraph(tasks: CollaborationTask[]) {
    const byID = new Map(tasks.map((task) => [task.taskID, task] as const));
    if (byID.size !== tasks.length) throw new Error("Duplicate taskID");
    tasks.forEach((task) =>
      task.dependsOnTaskIDs.forEach((dependencyID) => {
        if (!byID.has(dependencyID)) {
          throw new Error(`Unknown task dependency: ${dependencyID}`);
        }
      }),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (taskID: string) => {
      if (visiting.has(taskID)) throw new Error("Task dependency cycle detected");
      if (visited.has(taskID)) return;
      visiting.add(taskID);
      byID.get(taskID)!.dependsOnTaskIDs.forEach(visit);
      visiting.delete(taskID);
      visited.add(taskID);
    };
    tasks.forEach((task) => visit(task.taskID));
  }

  private driver(collaboration: CollaborationSession) {
    return collaboration.participants.find(
      (participant) => participant.role === "driver",
    )!;
  }

  private hasRole(
    collaboration: CollaborationSession,
    participantID: string,
    role: CollaborationRole,
  ) {
    return this.requireParticipant(collaboration, participantID).role === role;
  }

  private requireRole(
    collaboration: CollaborationSession,
    participantID: string,
    role: CollaborationRole,
  ) {
    if (!this.hasRole(collaboration, participantID, role)) {
      throw new Error(`Participant ${participantID} must have role ${role}`);
    }
  }

  private requireParticipant(
    collaboration: CollaborationSession,
    participantID: string,
  ) {
    const participant = collaboration.participants.find(
      (candidate) => candidate.participantID === participantID,
    );
    if (!participant) throw new Error(`Unknown participant: ${participantID}`);
    return participant;
  }

  private requireTask(collaboration: CollaborationSession, taskID: string) {
    const task = collaboration.tasks.find((candidate) => candidate.taskID === taskID);
    if (!task) throw new Error(`Unknown task: ${taskID}`);
    return task;
  }

  private requireSession(collaborationID: string) {
    const collaboration = this.sessions.get(collaborationID);
    if (!collaboration) {
      throw new Error(`Collaboration is not registered: ${collaborationID}`);
    }
    return collaboration;
  }

  private requireOperational(collaboration: CollaborationSession) {
    if (collaboration.status === "waiting_human") {
      throw new Error("Collaboration is waiting for human intervention");
    }
    if (collaboration.status === "completed" || collaboration.status === "aborted") {
      throw new Error(`Collaboration is ${collaboration.status}`);
    }
  }

  private async transact<T>(operation: () => Promise<T>) {
    await this.initialize();
    const result = this.mutation.then(operation);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async restore() {
    const snapshot = await this.store.load();
    if (!snapshot) return;
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported collaboration snapshot: ${snapshot.version}`);
    }
    snapshot.sessions.forEach((session) => {
      this.sessions.set(session.collaborationID, session);
      this.sessionByIdempotency.set(
        `${session.conversationID}:${session.idempotencyKey}`,
        session.collaborationID,
      );
    });
    snapshot.events.forEach((event) => {
      const events = this.events.get(event.collaborationID) ?? [];
      events.push(event);
      this.events.set(event.collaborationID, events);
    });
  }

  private async persist() {
    await this.store.save(this.snapshot());
    const committed = this.pendingEvents.splice(0);
    committed.forEach((event) => {
      this.listeners.forEach((listener) => {
        queueMicrotask(() => {
          try {
            listener(clone(event));
          } catch {
            // Event projection failures must not roll back committed domain state.
          }
        });
      });
    });
  }
}
