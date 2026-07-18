import type { AgentRuntimeCapability } from "./runtime";

export type GatewayAgentStatus = "online" | "offline";
export type GatewaySessionStatus = "active" | "closed";
export type GatewayRunStatus =
  | "queued"
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "completed"
  | "failed"
  | "aborted";
export type GatewayActorType = "human" | "agent" | "system";
export type GatewayRiskLevel = "low" | "medium" | "high";
export type GatewayGovernanceDecision = "allow" | "deny" | "require_human";
export type GatewayGovernanceAction =
  | "agent.register"
  | "session.create"
  | "session.close"
  | "run.start"
  | "run.abort"
  | "permission.reply"
  | "artifact.publish";

export interface GatewayAgentRecord {
  agentID: string;
  credentialID?: string;
  runtimeID: string;
  displayName: string;
  endpoint: string;
  capabilities: AgentRuntimeCapability[];
  status: GatewayAgentStatus;
  registeredAt: number;
  lastHeartbeatAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

export interface GatewaySessionRecord {
  sessionID: string;
  conversationID: string;
  status: GatewaySessionStatus;
  createdBy: {
    type: GatewayActorType;
    id: string;
  };
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface GatewayRunRecord {
  runID: string;
  conversationID: string;
  sessionID: string;
  targetAgentID: string;
  idempotencyKey: string;
  status: GatewayRunStatus;
  attempt: number;
  maxAttempts: number;
  input: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastSequence: number;
  nextRetryAt?: number;
  lastError?: string;
  claimedByAgentID?: string;
  claimedAt?: number;
  claimExpiresAt?: number;
}

export interface GatewayRunEventRecord {
  eventID: string;
  runID: string;
  sequence: number;
  state: GatewayRunStatus | "delta" | "tool_call_start" | "tool_call_end";
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface GatewayAuditRecord {
  auditID: string;
  action: GatewayGovernanceAction;
  actorType: GatewayActorType;
  actorID: string;
  risk: GatewayRiskLevel;
  decision: GatewayGovernanceDecision;
  reason: string;
  conversationID?: string;
  sessionID?: string;
  runID?: string;
  humanApproverID?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentGatewaySnapshot {
  version: 1 | 2;
  agents: GatewayAgentRecord[];
  sessions?: GatewaySessionRecord[];
  runs: GatewayRunRecord[];
  events: GatewayRunEventRecord[];
  audits: GatewayAuditRecord[];
}

export interface AgentGatewayStateStore {
  load(): Promise<AgentGatewaySnapshot | undefined>;
  save(snapshot: AgentGatewaySnapshot): Promise<void>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class InMemoryAgentGatewayStateStore implements AgentGatewayStateStore {
  snapshot?: AgentGatewaySnapshot;

  load() {
    return Promise.resolve(this.snapshot ? clone(this.snapshot) : undefined);
  }

  save(snapshot: AgentGatewaySnapshot) {
    this.snapshot = clone(snapshot);
    return Promise.resolve();
  }
}

export interface AgentGatewayOptions {
  heartbeatTtlMs?: number;
  humanApprovalTtlMs?: number;
  now?: () => number;
  createID?: () => string;
}

export interface GatewayAuthorizationRequest {
  action: GatewayGovernanceAction;
  actorType: GatewayActorType;
  actorID: string;
  risk: GatewayRiskLevel;
  conversationID?: string;
  sessionID?: string;
  runID?: string;
  humanApproval?: { approverID: string; approvedAt: number };
  metadata?: Record<string, unknown>;
}

export interface AgentGatewayMetrics {
  agents: { online: number; offline: number };
  sessions: { active: number; closed: number };
  runs: Record<GatewayRunStatus, number>;
  retries: number;
  events: number;
  audits: {
    allow: number;
    deny: number;
    requireHuman: number;
  };
}

const requireText = (value: string, name: string) => {
  if (!value.trim()) throw new Error(`${name} is required`);
};

const runStatusByEventState: Partial<
  Record<GatewayRunEventRecord["state"], GatewayRunStatus>
> = {
  queued: "queued",
  running: "running",
  waiting_permission: "waiting_permission",
  waiting_question: "waiting_question",
  completed: "completed",
  failed: "failed",
  aborted: "aborted",
};
const eventStates: readonly GatewayRunEventRecord["state"][] = [
  "queued",
  "running",
  "waiting_permission",
  "waiting_question",
  "completed",
  "failed",
  "aborted",
  "delta",
  "tool_call_start",
  "tool_call_end",
];
const actorTypes: readonly GatewayActorType[] = ["human", "agent", "system"];
const riskLevels: readonly GatewayRiskLevel[] = ["low", "medium", "high"];
const governanceActions: readonly GatewayGovernanceAction[] = [
  "agent.register",
  "session.create",
  "session.close",
  "run.start",
  "run.abort",
  "permission.reply",
  "artifact.publish",
];
const allowedRunTransitions: Record<GatewayRunStatus, GatewayRunStatus[]> = {
  queued: ["running", "failed", "aborted"],
  running: [
    "running",
    "waiting_permission",
    "waiting_question",
    "completed",
    "failed",
    "aborted",
  ],
  waiting_permission: [
    "running",
    "waiting_permission",
    "waiting_question",
    "completed",
    "failed",
    "aborted",
  ],
  waiting_question: [
    "running",
    "waiting_permission",
    "waiting_question",
    "completed",
    "failed",
    "aborted",
  ],
  completed: [],
  failed: [],
  aborted: [],
};

export class AgentGateway {
  private readonly agents = new Map<string, GatewayAgentRecord>();
  private readonly sessions = new Map<string, GatewaySessionRecord>();
  private readonly runs = new Map<string, GatewayRunRecord>();
  private readonly events = new Map<string, GatewayRunEventRecord[]>();
  private readonly audits: GatewayAuditRecord[] = [];
  private readonly runByIdempotencyKey = new Map<string, string>();
  private readonly heartbeatTtlMs: number;
  private readonly humanApprovalTtlMs: number;
  private readonly now: () => number;
  private readonly createID: () => string;
  private initialization?: Promise<void>;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: AgentGatewayStateStore,
    options: AgentGatewayOptions = {},
  ) {
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? 30000;
    this.humanApprovalTtlMs = options.humanApprovalTtlMs ?? 5 * 60_000;
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

  async registerAgent(params: {
    agentID: string;
    credentialID?: string;
    runtimeID: string;
    displayName: string;
    endpoint: string;
    capabilities: AgentRuntimeCapability[];
    metadata?: Record<string, unknown>;
  }) {
    return this.transact(async () => {
      requireText(params.agentID, "agentID");
      requireText(params.runtimeID, "runtimeID");
      requireText(params.displayName, "displayName");
      requireText(params.endpoint, "endpoint");
      if (new Set(params.capabilities).size !== params.capabilities.length) {
        throw new Error(`Agent ${params.agentID} declares duplicate capabilities`);
      }
      const timestamp = this.now();
      const previous = this.agents.get(params.agentID);
      const record: GatewayAgentRecord = {
        ...params,
        capabilities: [...params.capabilities],
        status: "online",
        registeredAt: previous?.registeredAt ?? timestamp,
        lastHeartbeatAt: timestamp,
        expiresAt: timestamp + this.heartbeatTtlMs,
      };
      this.agents.set(record.agentID, record);
      this.recordAuthorization({
        action: "agent.register",
        actorType: "system",
        actorID: "agent-gateway",
        risk: "low",
        metadata: { agentID: record.agentID, runtimeID: record.runtimeID },
      });
      await this.persist();
      return clone(record);
    });
  }

  async heartbeat(agentID: string) {
    return this.transact(async () => {
      const record = this.agents.get(agentID);
      if (!record) throw new Error(`Agent is not registered: ${agentID}`);
      const timestamp = this.now();
      record.status = "online";
      record.lastHeartbeatAt = timestamp;
      record.expiresAt = timestamp + this.heartbeatTtlMs;
      await this.persist();
      return clone(record);
    });
  }

  async setAgentOffline(agentID: string) {
    return this.transact(async () => {
      const record = this.agents.get(agentID);
      if (!record) return undefined;
      record.status = "offline";
      record.expiresAt = this.now();
      await this.persist();
      return clone(record);
    });
  }

  async sweepExpiredAgents() {
    return this.transact(async () => {
      const timestamp = this.now();
      const expired: string[] = [];
      for (const record of this.agents.values()) {
        if (record.status === "online" && record.expiresAt <= timestamp) {
          record.status = "offline";
          expired.push(record.agentID);
        }
      }
      if (expired.length > 0) await this.persist();
      return expired;
    });
  }

  discoverAgents(filter?: {
    capability?: AgentRuntimeCapability;
    includeOffline?: boolean;
  }) {
    return [...this.agents.values()]
      .filter(
        (record) =>
          (filter?.includeOffline || record.status === "online") &&
          (!filter?.capability || record.capabilities.includes(filter.capability)),
      )
      .sort((left, right) => left.agentID.localeCompare(right.agentID))
      .map((record) => clone(record));
  }

  getAgent(agentID: string) {
    const agent = this.agents.get(agentID);
    return agent ? clone(agent) : undefined;
  }

  async createSession(params: {
    sessionID: string;
    conversationID: string;
    actor: { type: GatewayActorType; id: string };
    metadata?: Record<string, unknown>;
  }) {
    return this.transact(async () => {
      requireText(params.sessionID, "sessionID");
      requireText(params.conversationID, "conversationID");
      const existing = this.sessions.get(params.sessionID);
      if (existing) {
        if (existing.conversationID !== params.conversationID) {
          throw new Error(
            `Session ${params.sessionID} belongs to another conversation`,
          );
        }
        return { created: false, session: clone(existing) };
      }
      const session = this.createSessionRecord(params);
      await this.persist();
      return { created: true, session: clone(session) };
    });
  }

  getSession(sessionID: string) {
    const session = this.sessions.get(sessionID);
    return session ? clone(session) : undefined;
  }

  listSessions(filter?: { conversationID?: string; status?: GatewaySessionStatus }) {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          (!filter?.conversationID ||
            session.conversationID === filter.conversationID) &&
          (!filter?.status || session.status === filter.status),
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.sessionID.localeCompare(right.sessionID),
      )
      .map((session) => clone(session));
  }

  async closeSession(params: {
    sessionID: string;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
  }) {
    return this.transact(async () => {
      const session = this.sessions.get(params.sessionID);
      if (!session) throw new Error(`Session is not registered: ${params.sessionID}`);
      const authorization = this.recordAuthorization({
        action: "session.close",
        actorType: params.actor.type,
        actorID: params.actor.id,
        risk: params.risk ?? "medium",
        conversationID: session.conversationID,
        sessionID: session.sessionID,
        humanApproval: params.humanApproval,
      });
      if (authorization.decision !== "allow") {
        await this.persist();
        throw new Error(
          `Session close requires human approval: ${authorization.reason}`,
        );
      }
      if (session.status === "closed") {
        await this.persist();
        return { closed: false, session: clone(session) };
      }
      const timestamp = this.now();
      session.status = "closed";
      session.closedAt = timestamp;
      session.updatedAt = timestamp;
      await this.persist();
      return { closed: true, session: clone(session) };
    });
  }

  async createRun(params: {
    conversationID: string;
    sessionID: string;
    targetAgentID: string;
    idempotencyKey: string;
    input: Record<string, unknown>;
    maxAttempts?: number;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
  }) {
    return this.transact(async () => {
      requireText(params.conversationID, "conversationID");
      requireText(params.sessionID, "sessionID");
      requireText(params.targetAgentID, "targetAgentID");
      requireText(params.idempotencyKey, "idempotencyKey");
      const idempotencyScope = `${params.conversationID}:${params.idempotencyKey}`;
      const existingID = this.runByIdempotencyKey.get(idempotencyScope);
      if (existingID) {
        return {
          created: false,
          run: clone(this.runs.get(existingID)!),
        };
      }
      const agent = this.agents.get(params.targetAgentID);
      if (!agent || agent.status !== "online") {
        throw new Error(`Target agent is unavailable: ${params.targetAgentID}`);
      }
      const existingSession = this.sessions.get(params.sessionID);
      if (existingSession && existingSession.conversationID !== params.conversationID) {
        throw new Error(`Session ${params.sessionID} belongs to another conversation`);
      }
      if (existingSession?.status === "closed") {
        throw new Error(`Session is closed: ${params.sessionID}`);
      }
      const maxAttempts = params.maxAttempts ?? 3;
      if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error("maxAttempts must be a positive integer");
      }
      const authorization = this.recordAuthorization({
        action: "run.start",
        actorType: params.actor.type,
        actorID: params.actor.id,
        risk: params.risk ?? "medium",
        conversationID: params.conversationID,
        sessionID: params.sessionID,
        humanApproval: params.humanApproval,
      });
      if (authorization.decision !== "allow") {
        await this.persist();
        throw new Error(`Run start requires human approval: ${authorization.reason}`);
      }
      const session =
        existingSession ??
        this.createSessionRecord({
          sessionID: params.sessionID,
          conversationID: params.conversationID,
          actor: params.actor,
        });
      const timestamp = this.now();
      const run: GatewayRunRecord = {
        conversationID: params.conversationID,
        sessionID: params.sessionID,
        targetAgentID: params.targetAgentID,
        idempotencyKey: params.idempotencyKey,
        input: params.input,
        runID: this.createID(),
        status: "queued",
        attempt: 1,
        maxAttempts,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSequence: -1,
      };
      this.runs.set(run.runID, run);
      this.runByIdempotencyKey.set(idempotencyScope, run.runID);
      session.updatedAt = timestamp;
      await this.persist();
      return { created: true, run: clone(run) };
    });
  }

  async authorizeAction(request: GatewayAuthorizationRequest) {
    return this.transact(async () => {
      const audit = this.recordAuthorization(request);
      await this.persist();
      return clone(audit);
    });
  }

  async retryRun(
    runID: string,
    options: { delayMs?: number; lastError?: string } = {},
  ) {
    return this.transact(async () => {
      const run = this.runs.get(runID);
      if (!run) throw new Error(`Run is not registered: ${runID}`);
      if (run.status !== "failed") {
        throw new Error(`Only failed runs can be retried: ${runID}`);
      }
      if (run.attempt >= run.maxAttempts) {
        return { scheduled: false, run: clone(run) };
      }
      const timestamp = this.now();
      run.attempt += 1;
      run.status = "queued";
      run.updatedAt = timestamp;
      run.nextRetryAt = timestamp + Math.max(0, options.delayMs ?? 0);
      run.lastError = options.lastError;
      run.claimedByAgentID = undefined;
      run.claimedAt = undefined;
      run.claimExpiresAt = undefined;
      await this.persist();
      return { scheduled: true, run: clone(run) };
    });
  }

  async abortRun(params: {
    runID: string;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
    reason?: string;
  }) {
    return this.transact(async () => {
      const run = this.runs.get(params.runID);
      if (!run) throw new Error(`Run is not registered: ${params.runID}`);
      const authorization = this.recordAuthorization({
        action: "run.abort",
        actorType: params.actor.type,
        actorID: params.actor.id,
        risk: params.risk ?? "medium",
        conversationID: run.conversationID,
        sessionID: run.sessionID,
        runID: run.runID,
        humanApproval: params.humanApproval,
      });
      if (authorization.decision !== "allow") {
        await this.persist();
        throw new Error(`Run abort requires human approval: ${authorization.reason}`);
      }
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "aborted"
      ) {
        await this.persist();
        return { aborted: false, run: clone(run) };
      }
      run.status = "aborted";
      run.updatedAt = this.now();
      run.lastError = params.reason;
      run.claimedByAgentID = undefined;
      run.claimedAt = undefined;
      run.claimExpiresAt = undefined;
      const event = this.appendEvent(run, "aborted", {
        reason: params.reason,
        actor: params.actor,
      });
      await this.persist();
      return { aborted: true, run: clone(run), event: clone(event) };
    });
  }

  listRuns(filter?: {
    targetAgentID?: string;
    status?: GatewayRunStatus;
    availableOnly?: boolean;
  }) {
    const timestamp = this.now();
    return [...this.runs.values()]
      .filter(
        (run) =>
          (!filter?.targetAgentID || run.targetAgentID === filter.targetAgentID) &&
          (!filter?.status || run.status === filter.status) &&
          (!filter?.availableOnly ||
            (run.status === "queued" && (run.nextRetryAt ?? 0) <= timestamp)),
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.runID.localeCompare(right.runID),
      )
      .map((run) => clone(run));
  }

  async claimRun(params: { runID: string; agentID: string; leaseMs?: number }) {
    return this.transact(async () => {
      requireText(params.agentID, "agentID");
      const run = this.runs.get(params.runID);
      if (!run) throw new Error(`Run is not registered: ${params.runID}`);
      if (run.targetAgentID !== params.agentID) {
        throw new Error("Only the target agent can claim a run");
      }
      const agent = this.agents.get(params.agentID);
      if (!agent || agent.status !== "online") {
        throw new Error(`Claiming agent is unavailable: ${params.agentID}`);
      }
      const timestamp = this.now();
      if (run.status !== "queued" || (run.nextRetryAt ?? 0) > timestamp) {
        return { claimed: false, run: clone(run) };
      }
      const leaseMs = params.leaseMs ?? 30_000;
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
        throw new Error("leaseMs must be an integer between 1000 and 300000");
      }
      run.status = "running";
      run.updatedAt = timestamp;
      run.claimedByAgentID = params.agentID;
      run.claimedAt = timestamp;
      run.claimExpiresAt = timestamp + leaseMs;
      const event = this.appendEvent(run, "running", {
        agentID: params.agentID,
        leaseMs,
      });
      await this.persist();
      return { claimed: true, run: clone(run), event: clone(event) };
    });
  }

  async renewRunClaim(params: { runID: string; agentID: string; leaseMs?: number }) {
    return this.transact(async () => {
      const run = this.runs.get(params.runID);
      if (!run) throw new Error(`Run is not registered: ${params.runID}`);
      if (
        (run.status !== "running" &&
          run.status !== "waiting_permission" &&
          run.status !== "waiting_question") ||
        run.claimedByAgentID !== params.agentID ||
        (run.claimExpiresAt ?? 0) <= this.now()
      ) {
        throw new Error("Run claim is not active for this agent");
      }
      const leaseMs = params.leaseMs ?? 30_000;
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
        throw new Error("leaseMs must be an integer between 1000 and 300000");
      }
      run.claimExpiresAt = this.now() + leaseMs;
      run.updatedAt = this.now();
      await this.persist();
      return clone(run);
    });
  }

  async recoverExpiredRunClaims() {
    return this.transact(async () => {
      const timestamp = this.now();
      const recovered: GatewayRunRecord[] = [];
      for (const run of this.runs.values()) {
        if (
          (run.status !== "running" &&
            run.status !== "waiting_permission" &&
            run.status !== "waiting_question") ||
          !run.claimExpiresAt ||
          run.claimExpiresAt > timestamp
        ) {
          continue;
        }
        run.lastError = "Worker claim expired before the run completed.";
        run.updatedAt = timestamp;
        run.claimedByAgentID = undefined;
        run.claimedAt = undefined;
        run.claimExpiresAt = undefined;
        if (run.attempt < run.maxAttempts) {
          run.attempt += 1;
          run.status = "queued";
          run.nextRetryAt = timestamp;
          this.appendEvent(run, "queued", {
            recovery: "claim_expired",
            attempt: run.attempt,
          });
        } else {
          run.status = "failed";
          this.appendEvent(run, "failed", {
            error: run.lastError,
            recovery: "claim_expired",
          });
        }
        recovered.push(clone(run));
      }
      if (recovered.length > 0) await this.persist();
      return recovered;
    });
  }

  async appendRunEvent(params: {
    eventID: string;
    runID: string;
    state: GatewayRunEventRecord["state"];
    payload?: Record<string, unknown>;
  }) {
    return this.transact(async () => {
      requireText(params.eventID, "eventID");
      if (!eventStates.includes(params.state)) {
        throw new Error(`Unsupported run event state: ${String(params.state)}`);
      }
      const run = this.runs.get(params.runID);
      if (!run) throw new Error(`Run is not registered: ${params.runID}`);
      const runEvents = this.events.get(run.runID) ?? [];
      const duplicate = runEvents.find((event) => event.eventID === params.eventID);
      if (duplicate) return { appended: false, event: clone(duplicate) };
      const nextStatus = runStatusByEventState[params.state];
      if (nextStatus && !allowedRunTransitions[run.status].includes(nextStatus)) {
        throw new Error(`Invalid run transition: ${run.status} -> ${nextStatus}`);
      }
      if (
        !nextStatus &&
        (run.status === "completed" ||
          run.status === "failed" ||
          run.status === "aborted")
      ) {
        throw new Error(`Cannot append events to terminal run: ${run.runID}`);
      }

      const event: GatewayRunEventRecord = {
        eventID: params.eventID,
        runID: run.runID,
        sequence: run.lastSequence + 1,
        state: params.state,
        payload: params.payload ?? {},
        createdAt: this.now(),
      };
      runEvents.push(event);
      this.events.set(run.runID, runEvents);
      run.lastSequence = event.sequence;
      run.updatedAt = event.createdAt;
      const session = this.sessions.get(run.sessionID);
      if (session) session.updatedAt = event.createdAt;
      run.status = runStatusByEventState[event.state] ?? run.status;
      if (event.state === "failed" && typeof event.payload.error === "string") {
        run.lastError = event.payload.error;
      }
      if (
        event.state === "completed" ||
        event.state === "failed" ||
        event.state === "aborted"
      ) {
        run.claimedByAgentID = undefined;
        run.claimedAt = undefined;
        run.claimExpiresAt = undefined;
      }
      await this.persist();
      return { appended: true, event: clone(event) };
    });
  }

  getRun(runID: string) {
    const run = this.runs.get(runID);
    return run ? clone(run) : undefined;
  }

  private appendEvent(
    run: GatewayRunRecord,
    state: GatewayRunEventRecord["state"],
    payload: Record<string, unknown>,
  ) {
    const event: GatewayRunEventRecord = {
      eventID: this.createID(),
      runID: run.runID,
      sequence: run.lastSequence + 1,
      state,
      payload,
      createdAt: this.now(),
    };
    const events = this.events.get(run.runID) ?? [];
    events.push(event);
    this.events.set(run.runID, events);
    run.lastSequence = event.sequence;
    return event;
  }

  listRunEvents(runID: string, afterSequence = -1) {
    return (this.events.get(runID) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map((event) => clone(event));
  }

  listAuditRecords(filter?: { conversationID?: string; runID?: string }) {
    return this.audits
      .filter(
        (audit) =>
          (!filter?.conversationID || audit.conversationID === filter.conversationID) &&
          (!filter?.runID || audit.runID === filter.runID),
      )
      .map((audit) => clone(audit));
  }

  getMetrics(): AgentGatewayMetrics {
    const runCounts: AgentGatewayMetrics["runs"] = {
      queued: 0,
      running: 0,
      waiting_permission: 0,
      waiting_question: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
    };
    let online = 0;
    let offline = 0;
    let activeSessions = 0;
    let closedSessions = 0;
    let retries = 0;
    this.agents.forEach((agent) =>
      agent.status === "online" ? (online += 1) : (offline += 1),
    );
    this.runs.forEach((run) => {
      runCounts[run.status] += 1;
      retries += Math.max(0, run.attempt - 1);
    });
    this.sessions.forEach((session) =>
      session.status === "active" ? (activeSessions += 1) : (closedSessions += 1),
    );
    return {
      agents: { online, offline },
      sessions: { active: activeSessions, closed: closedSessions },
      runs: runCounts,
      retries,
      events: [...this.events.values()].reduce(
        (total, events) => total + events.length,
        0,
      ),
      audits: {
        allow: this.audits.filter((audit) => audit.decision === "allow").length,
        deny: this.audits.filter((audit) => audit.decision === "deny").length,
        requireHuman: this.audits.filter((audit) => audit.decision === "require_human")
          .length,
      },
    };
  }

  snapshot(): AgentGatewaySnapshot {
    return {
      version: 2,
      agents: [...this.agents.values()].map((value) => clone(value)),
      sessions: [...this.sessions.values()].map((value) => clone(value)),
      runs: [...this.runs.values()].map((value) => clone(value)),
      events: [...this.events.values()].flat().map((value) => clone(value)),
      audits: this.audits.map((value) => clone(value)),
    };
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
    if (snapshot.version !== 1 && snapshot.version !== 2) {
      throw new Error(`Unsupported agent gateway snapshot: ${snapshot.version}`);
    }
    snapshot.agents.forEach((record) => this.agents.set(record.agentID, record));
    (snapshot.sessions ?? []).forEach((session) =>
      this.sessions.set(session.sessionID, session),
    );
    snapshot.runs.forEach((run) => {
      this.runs.set(run.runID, run);
      this.runByIdempotencyKey.set(
        `${run.conversationID}:${run.idempotencyKey}`,
        run.runID,
      );
      if (!this.sessions.has(run.sessionID)) {
        this.sessions.set(run.sessionID, {
          sessionID: run.sessionID,
          conversationID: run.conversationID,
          status: "active",
          createdBy: { type: "system", id: "agent-gateway-migration" },
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          metadata: { migratedFromSnapshotVersion: snapshot.version },
        });
      } else {
        const session = this.sessions.get(run.sessionID)!;
        session.createdAt = Math.min(session.createdAt, run.createdAt);
        session.updatedAt = Math.max(session.updatedAt, run.updatedAt);
      }
    });
    snapshot.events.forEach((event) => {
      const runEvents = this.events.get(event.runID) ?? [];
      runEvents.push(event);
      this.events.set(event.runID, runEvents);
    });
    (snapshot.audits ?? []).forEach((audit) => this.audits.push(audit));
  }

  private recordAuthorization(
    request: GatewayAuthorizationRequest,
  ): GatewayAuditRecord {
    requireText(request.actorID, "actorID");
    if (!governanceActions.includes(request.action)) {
      throw new Error(
        `Unsupported gateway governance action: ${String(request.action)}`,
      );
    }
    if (!actorTypes.includes(request.actorType)) {
      throw new Error(`Unsupported gateway actor type: ${String(request.actorType)}`);
    }
    if (!riskLevels.includes(request.risk)) {
      throw new Error(`Unsupported gateway risk level: ${String(request.risk)}`);
    }
    const requiresHuman =
      request.risk === "high" ||
      (request.actorType === "agent" &&
        (request.action === "permission.reply" ||
          request.action === "artifact.publish"));
    const approvalAge = request.humanApproval
      ? this.now() - request.humanApproval.approvedAt
      : Number.POSITIVE_INFINITY;
    const humanApproved = Boolean(
      request.humanApproval?.approverID.trim() &&
        Number.isFinite(request.humanApproval.approvedAt) &&
        approvalAge >= -60_000 &&
        approvalAge <= this.humanApprovalTtlMs,
    );
    const decision: GatewayGovernanceDecision =
      requiresHuman && !humanApproved ? "require_human" : "allow";
    const reason =
      decision === "allow"
        ? humanApproved
          ? "Explicit human approval recorded"
          : "Action is permitted by the default gateway policy"
        : "High-risk or privileged agent action requires explicit human approval";
    const audit: GatewayAuditRecord = {
      auditID: this.createID(),
      action: request.action,
      actorType: request.actorType,
      actorID: request.actorID,
      risk: request.risk,
      decision,
      reason,
      conversationID: request.conversationID,
      sessionID: request.sessionID,
      runID: request.runID,
      humanApproverID: humanApproved ? request.humanApproval?.approverID : undefined,
      createdAt: this.now(),
      metadata: request.metadata,
    };
    this.audits.push(audit);
    return audit;
  }

  private createSessionRecord(params: {
    sessionID: string;
    conversationID: string;
    actor: { type: GatewayActorType; id: string };
    metadata?: Record<string, unknown>;
  }) {
    const authorization = this.recordAuthorization({
      action: "session.create",
      actorType: params.actor.type,
      actorID: params.actor.id,
      risk: "low",
      conversationID: params.conversationID,
      sessionID: params.sessionID,
    });
    if (authorization.decision !== "allow") {
      throw new Error(`Session creation was denied: ${authorization.reason}`);
    }
    const timestamp = this.now();
    const session: GatewaySessionRecord = {
      sessionID: params.sessionID,
      conversationID: params.conversationID,
      status: "active",
      createdBy: { ...params.actor },
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: params.metadata,
    };
    this.sessions.set(session.sessionID, session);
    return session;
  }

  private persist() {
    return this.store.save(this.snapshot());
  }
}
