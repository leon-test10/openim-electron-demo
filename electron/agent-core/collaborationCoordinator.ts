import type {
  AgentCollaborationEngine,
  CollaborationParticipant,
} from "./collaboration";
import type { AgentGateway, GatewayRunEventRecord } from "./gateway";

export class AgentCollaborationCoordinator {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly collaboration: AgentCollaborationEngine,
  ) {}

  async dispatchReadyTasks(params: {
    collaborationID: string;
    requestedByParticipantID: string;
    humanApproval?: { approverID: string; approvedAt: number };
  }) {
    const session = this.requireCollaboration(params.collaborationID);
    const requester = this.requireParticipant(
      session.participants,
      params.requestedByParticipantID,
    );
    if (requester.role !== "driver") {
      throw new Error("Only the driver can dispatch collaboration tasks");
    }

    const ready = this.collaboration.listReadyTasks(params.collaborationID);
    const manualTasks = ready.filter(
      (task) =>
        this.requireParticipant(session.participants, task.assigneeParticipantID)
          .kind === "human",
    );
    const agentTasks = ready.filter((task) => !manualTasks.includes(task));
    if (
      agentTasks.some((task) => task.risk === "high") &&
      !params.humanApproval?.approverID.trim()
    ) {
      throw new Error("High-risk collaboration tasks require human approval");
    }
    const onlineAgentIDs = new Set(
      this.gateway.discoverAgents().map((agent) => agent.agentID),
    );
    agentTasks.forEach((task) => {
      const assignee = this.requireParticipant(
        session.participants,
        task.assigneeParticipantID,
      );
      if (!assignee.agentID || !onlineAgentIDs.has(assignee.agentID)) {
        throw new Error(
          `Collaboration assignee is unavailable: ${String(assignee.agentID)}`,
        );
      }
    });
    const dispatched = await Promise.all(
      agentTasks.map(async (task) => {
        const assignee = this.requireParticipant(
          session.participants,
          task.assigneeParticipantID,
        );
        if (!assignee.agentID) {
          throw new Error(
            `Agent participant has no gateway agentID: ${assignee.participantID}`,
          );
        }
        const dependencies = session.tasks
          .filter((candidate) => task.dependsOnTaskIDs.includes(candidate.taskID))
          .map((candidate) => ({
            taskID: candidate.taskID,
            output: candidate.output,
          }));
        const run = await this.gateway.createRun({
          conversationID: session.conversationID,
          sessionID: session.sessionID,
          targetAgentID: assignee.agentID,
          idempotencyKey: `${session.collaborationID}:${task.taskID}`,
          input: {
            collaborationID: session.collaborationID,
            objective: session.objective,
            taskID: task.taskID,
            title: task.title,
            instruction: task.instruction,
            dependencies,
          },
          actor: { type: requester.kind, id: requester.principalID },
          risk: task.risk,
          humanApproval: params.humanApproval,
        });
        const started = await this.collaboration.startTask({
          collaborationID: session.collaborationID,
          taskID: task.taskID,
          assigneeParticipantID: assignee.participantID,
          runID: run.run.runID,
        });
        return { task: started, run: run.run, created: run.created };
      }),
    );
    return { dispatched, manualTasks };
  }

  async applyRunEvent(params: {
    collaborationID: string;
    runID: string;
    eventID: string;
    state: GatewayRunEventRecord["state"];
    payload?: Record<string, unknown>;
  }) {
    const appended = await this.gateway.appendRunEvent({
      eventID: params.eventID,
      runID: params.runID,
      state: params.state,
      payload: params.payload,
    });
    if (!appended.appended) return { applied: false, event: appended.event };

    const session = this.requireCollaboration(params.collaborationID);
    const task = session.tasks.find((candidate) => candidate.runID === params.runID);
    if (!task) throw new Error(`No collaboration task for run: ${params.runID}`);
    const assignee = this.requireParticipant(
      session.participants,
      task.assigneeParticipantID,
    );
    if (assignee.role === "reviewer" && params.state === "completed") {
      await this.collaboration.requestHumanIntervention({
        collaborationID: session.collaborationID,
        requestedByParticipantID: assignee.participantID,
        reason: "Agent review is ready for the human final decision",
        risk: "medium",
        pendingAction: {
          type: "review.finalize",
          reviewTaskID: task.taskID,
          recommendation: params.payload ?? {},
        },
      });
      return {
        applied: true,
        event: appended.event,
        reviewPending: { task, output: params.payload ?? {} },
      };
    }
    if (params.state === "completed") {
      await this.collaboration.completeTask({
        collaborationID: session.collaborationID,
        taskID: task.taskID,
        assigneeParticipantID: assignee.participantID,
        output: params.payload ?? {},
      });
    } else if (params.state === "failed" || params.state === "aborted") {
      await this.collaboration.failTask({
        collaborationID: session.collaborationID,
        taskID: task.taskID,
        assigneeParticipantID: assignee.participantID,
        error:
          typeof params.payload?.error === "string"
            ? params.payload.error
            : `Run ${params.state}`,
      });
    }
    return { applied: true, event: appended.event };
  }

  async reconcileRun(runID: string) {
    const run = this.gateway.getRun(runID);
    if (!run) throw new Error(`Unknown Gateway run: ${runID}`);
    const session = this.collaboration
      .snapshot()
      .sessions.find((candidate) =>
        candidate.tasks.some((task) => task.runID === runID),
      );
    const task = session?.tasks.find((candidate) => candidate.runID === runID);
    if (!session || !task || task.status !== "running") {
      return { reconciled: false };
    }
    if (run.status !== "failed" && run.status !== "aborted") {
      return { reconciled: false };
    }
    const assignee = this.requireParticipant(
      session.participants,
      task.assigneeParticipantID,
    );
    await this.collaboration.failTask({
      collaborationID: session.collaborationID,
      taskID: task.taskID,
      assigneeParticipantID: assignee.participantID,
      error: run.lastError ?? `Run ${run.status}`,
    });
    return { reconciled: true };
  }

  private requireCollaboration(collaborationID: string) {
    const session = this.collaboration.getCollaboration(collaborationID);
    if (!session) throw new Error(`Unknown collaboration: ${collaborationID}`);
    return session;
  }

  private requireParticipant(
    participants: CollaborationParticipant[],
    participantID: string,
  ) {
    const participant = participants.find(
      (candidate) => candidate.participantID === participantID,
    );
    if (!participant) throw new Error(`Unknown participant: ${participantID}`);
    return participant;
  }
}
