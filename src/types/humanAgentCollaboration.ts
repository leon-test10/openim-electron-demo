export const MIN_AGENT_CONTEXT_MESSAGES = 1;
export const MAX_AGENT_CONTEXT_MESSAGES = 200;

export interface ContextPolicy {
  ownerUserID: string;
  recentMessageLimit: number;
  selectedMessageIDs?: string[];
  includeAttachments: boolean;
  allowedConversationIDs: string[];
}

export interface AgentRequest {
  requestID: string;
  conversationID: string;
  requesterUserID: string;
  targetAgentID: string;
  runtimeID?: string;
  instruction: string;
  contextPolicy: ContextPolicy;
  createdAt: number;
}

export type ConversationAgentBindingState =
  | "unbound"
  | "bound"
  | "runtime_starting"
  | "runtime_running"
  | "runtime_disconnected"
  | "im_offline"
  | "recovering"
  | "failed";

export type AgentArtifactType = "file" | "folder" | "image" | "text";
export type AgentArtifactStatus = "staged" | "approved" | "published" | "failed";

export interface AgentArtifact {
  artifactID: string;
  requestID: string;
  runID: string;
  type: AgentArtifactType;
  name: string;
  localPath?: string;
  storageURL?: string;
  status: AgentArtifactStatus;
}

export type AgentStagedResultStatus =
  | "running"
  | "completed_staged"
  | "approved"
  | "published"
  | "rejected";

export interface AgentStagedResult {
  resultID: string;
  requestID: string;
  runID: string;
  sessionID: string;
  messageID: string;
  status: AgentStagedResultStatus;
  finalAnswer: string;
  originalFinalAnswer: string;
  textPublished?: boolean;
  artifacts: AgentArtifact[];
  authorizedContextMessageCount: number;
  createdAt: number;
  updatedAt: number;
  publicationError?: string;
}

export interface AgentRunTraceSummary {
  traceID: string;
  requestID: string;
  runID: string;
  requesterUserID: string;
  runtimeID: string;
  startedAt: number;
  finishedAt?: number;
  status: string;
  retryCount: number;
  permissionCount: number;
  questionCount: number;
  artifactCount: number;
  humanTakeover: boolean;
  published: boolean;
  failureCode?: string;
}

export type ImprovementCandidateSource =
  | "runtime_error"
  | "repeated_retry"
  | "human_takeover"
  | "publication_failure"
  | "user_feedback";

export type ImprovementCandidateStatus =
  | "new"
  | "approved"
  | "rejected"
  | "converted_to_goal";

export interface ImprovementCandidate {
  candidateID: string;
  source: ImprovementCandidateSource;
  relatedTraceIDs: string[];
  title: string;
  description: string;
  status: ImprovementCandidateStatus;
  createdAt: number;
}

export interface AgentRequestEnvelope {
  schema: "openim-agent.request.v1";
  request: AgentRequest;
}
