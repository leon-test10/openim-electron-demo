import type {
  AgentCollaborationEngine,
  CollaborationEvent,
  CollaborationSession,
} from "../agent-core";
import { IpcMainToRender } from "../constants";
import { agentSessionManager } from "./agentSessionManage";
import { sendEvent } from "./windowManage";

const eventText = (collaboration: CollaborationSession, event: CollaborationEvent) => {
  const participant = collaboration.participants.find(
    (candidate) => candidate.participantID === event.actorParticipantID,
  );
  const actor = participant?.displayName ?? event.actorParticipantID;
  const taskID = typeof event.payload.taskID === "string" ? event.payload.taskID : "";
  const task = taskID
    ? collaboration.tasks.find((candidate) => candidate.taskID === taskID)
    : undefined;
  const taskName = task?.title ?? taskID;
  switch (event.type) {
    case "collaboration.created":
      return `协作已创建：${collaboration.objective}`;
    case "tasks.delegated":
      return `任务已委派，共 ${
        Array.isArray(event.payload.taskIDs) ? event.payload.taskIDs.length : 0
      } 项。`;
    case "task.started":
      return `${actor} 开始执行：${taskName}`;
    case "task.completed":
      return `${actor} 已完成：${taskName}`;
    case "task.failed":
      return `${actor} 执行失败：${taskName}。${String(
        event.payload.error ?? "",
      )}`.trim();
    case "review.started":
      return "所有工作任务已汇聚，进入审阅阶段。";
    case "review.approved":
      return `${actor} 已通过审阅。`;
    case "review.revision_requested":
      return `${actor} 要求修订：${String(event.payload.feedback ?? "")}`;
    case "human.requested":
      return `需要人工介入（${String(event.payload.risk ?? "medium")}）：${String(
        event.payload.reason ?? "",
      )}`;
    case "human.resolved":
      return `${actor} 已处理人工介入：${String(event.payload.decision ?? "")}${
        event.payload.instruction ? `；指示：${String(event.payload.instruction)}` : ""
      }`;
    case "collaboration.completed":
      return `协作完成：${String(
        event.payload.finalSummary ?? collaboration.finalSummary ?? "",
      )}`;
    case "collaboration.aborted":
      return `协作已由人工终止：${String(event.payload.reason ?? "")}`;
  }
};

const collaborationArtifacts = (collaboration: CollaborationSession) =>
  collaboration.tasks.flatMap((task) => {
    const artifacts = Array.isArray(task.output?.artifacts)
      ? task.output.artifacts
      : [];
    return artifacts
      .filter(
        (
          artifact,
        ): artifact is {
          nativePath: string;
          fileName?: string;
          kind?: string;
          size?: number;
        } =>
          Boolean(artifact) &&
          typeof artifact === "object" &&
          !Array.isArray(artifact) &&
          typeof (artifact as Record<string, unknown>).nativePath === "string",
      )
      .map((artifact) => ({
        nativePath: artifact.nativePath,
        fileName: typeof artifact.fileName === "string" ? artifact.fileName : undefined,
        kind: typeof artifact.kind === "string" ? artifact.kind : undefined,
        size: typeof artifact.size === "number" ? artifact.size : undefined,
      }));
  });

export class AgentCollaborationBridge {
  private unsubscribe?: () => void;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly collaboration: AgentCollaborationEngine) {}

  async initialize() {
    if (this.unsubscribe) return;
    this.stopped = false;
    await Promise.all([
      this.collaboration.initialize(),
      agentSessionManager.initialize(),
    ]);
    if (this.stopped) return;
    for (const session of this.collaboration.snapshot().sessions) {
      for (const event of this.collaboration.listEvents(session.collaborationID)) {
        await this.mirror(event);
      }
    }
    if (this.stopped) return;
    this.unsubscribe = this.collaboration.subscribe((event) => {
      this.queue = this.queue.then(() => this.mirror(event)).catch(() => undefined);
    });
  }

  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async mirror(event: CollaborationEvent) {
    const collaboration = this.collaboration.getCollaboration(event.collaborationID);
    if (!collaboration) return;
    sendEvent(IpcMainToRender.agentCollaborationEvent, {
      event,
      collaboration,
    });
    const session = await agentSessionManager.getSession(collaboration.sessionID);
    if (!session || session.conversationID !== collaboration.conversationID) return;
    await agentSessionManager.appendCollaborationMessage({
      sessionID: collaboration.sessionID,
      eventID: event.eventID,
      collaborationID: collaboration.collaborationID,
      sequence: event.sequence,
      eventType: event.type,
      text: eventText(collaboration, event),
      role: event.type === "collaboration.completed" ? "assistant" : "system",
      createdAt: event.createdAt,
      notify: event.type === "human.requested",
      artifacts:
        event.type === "collaboration.completed"
          ? collaborationArtifacts(collaboration)
          : undefined,
    });
  }
}
