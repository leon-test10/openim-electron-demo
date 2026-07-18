export type CollaborationParticipant = {
  participantID: string;
  kind: "human" | "agent";
  principalID: string;
  displayName: string;
  role: "driver" | "worker" | "reviewer" | "observer";
  agentID?: string;
};

export type CollaborationTask = {
  taskID: string;
  title: string;
  instruction: string;
  assigneeParticipantID: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  output?: Record<string, unknown>;
};

export type CollaborationSession = {
  collaborationID: string;
  conversationID: string;
  sessionID: string;
  objective: string;
  status:
    | "planning"
    | "running"
    | "reviewing"
    | "waiting_human"
    | "completed"
    | "failed"
    | "aborted";
  participants: CollaborationParticipant[];
  tasks: CollaborationTask[];
  intervention?: {
    requestID: string;
    reason: string;
    resolvedAt?: number;
  };
  finalSummary?: string;
};

export type GatewayAgentRecord = {
  agentID: string;
  displayName: string;
  capabilities: string[];
  status: "online" | "offline";
};
