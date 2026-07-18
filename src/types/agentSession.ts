import type { AgentRuntimeID } from "../agent-core/identity";
import type {
  AgentInteraction,
  AgentMessage,
  AgentModelRef,
  AgentQuestionInteraction,
  AgentSessionStatus,
} from "../agent-core/sessionTypes";

export type {
  AgentInteraction,
  AgentMessage,
  AgentMessagePart,
  AgentMessageRole,
  AgentModelOption,
  AgentModelRef,
  AgentPermissionInteraction,
  AgentQuestionInfo,
  AgentQuestionInteraction,
  AgentQuestionOption,
  AgentSessionStatus,
} from "../agent-core/sessionTypes";

export type AgentSessionKind = "manual" | "bot";

export type AgentTurnSource = "manual" | "bot" | "context";
export type AgentTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTurn {
  id: string;
  sessionID: string;
  source: AgentTurnSource;
  prompt: string;
  status: AgentTurnStatus;
  createdAt: number;
  updatedAt: number;
  triggerMessageID?: string;
  contextPaths?: string[];
  lastError?: string;
}

export interface AgentSession {
  id: string;
  conversationID: string;
  kind: AgentSessionKind;
  title: string;
  runtime: AgentRuntimeID;
  runtimeSessionID?: string;
  workspacePath: string;
  managedWorkspace: boolean;
  status: AgentSessionStatus;
  pinned: boolean;
  archived: boolean;
  unreadCount: number;
  liveHistoryEnabled: boolean;
  autoReplyTextEnabled?: boolean;
  autoReplyTextEnabledAt?: number;
  autoFileAttachmentEnabled?: boolean;
  autoFileAttachmentEnabledAt?: number;
  lastAutoReplyMessageID?: string;
  lastAutoAttachmentMessageID?: string;
  model?: AgentModelRef;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  lastCompletedAt?: number;
  lastError?: string;
  parentSessionID?: string;
  collaborationID?: string;
  gatewayRunID?: string;
  messages: AgentMessage[];
  turns: AgentTurn[];
  interactions: AgentInteraction[];
}

export type BotConversationPolicy = "off" | "review" | "auto";

export type BotRequestStatus =
  | "pending_review"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "ignored";

export interface BotRequest {
  id: string;
  conversationID: string;
  triggerMessageID: string;
  triggerText: string;
  instructionText: string;
  senderUserID: string;
  senderNickname?: string;
  targetUserID: string;
  contextLimit: number;
  status: BotRequestStatus;
  createdAt: number;
  updatedAt: number;
  agentSessionID?: string;
  contextPaths?: string[];
  lastError?: string;
}

export interface AgentSessionStateSnapshot {
  sessions: AgentSession[];
  activeSessionByConversation: Record<string, string | undefined>;
  botPolicyByConversation: Record<string, BotConversationPolicy>;
  botContextLimitByConversation: Record<string, number | undefined>;
  botCheckpointByConversation: Record<string, string | undefined>;
  botRequests: BotRequest[];
  agentPanelOpen: boolean;
  terminalPanelOpen: boolean;
  runtimeBaseUrl?: string;
  initialized: boolean;
}

export interface CreateAgentSessionParams {
  conversationID: string;
  title?: string;
  kind?: AgentSessionKind;
  workspacePath?: string;
  initialPrompt?: string;
  liveHistoryEnabled?: boolean;
  activate?: boolean;
  parentSessionID?: string;
  collaborationID?: string;
  gatewayRunID?: string;
}

export interface SendAgentMessageParams {
  sessionID: string;
  text: string;
  source?: AgentTurnSource;
  triggerMessageID?: string;
  contextPaths?: string[];
}

export interface UpdateAgentSessionParams {
  sessionID: string;
  title?: string;
  pinned?: boolean;
  liveHistoryEnabled?: boolean;
  autoReplyTextEnabled?: boolean;
  autoFileAttachmentEnabled?: boolean;
  model?: AgentModelRef;
}

export interface AgentViewportState {
  conversationID?: string;
  sessionID?: string;
  visible: boolean;
}

export interface IMHistoryToolQuery {
  mode: "recent" | "search";
  limit?: number;
  beforeClientMsgID?: string;
  keyword?: string;
}

export interface IMHistoryMessage {
  clientMsgID: string;
  senderUserID: string;
  senderNickname?: string;
  sendTime?: number;
  contentType: number;
  text: string;
  attachments: Array<{
    kind: string;
    name?: string;
    url?: string;
    size?: number;
  }>;
}

export interface IMHistoryToolResult {
  messages: IMHistoryMessage[];
  isEnd: boolean;
  nextCursor?: string;
}

export interface AgentHistoryQueryRequest {
  requestID: string;
  sessionID: string;
  conversationID: string;
  query: IMHistoryToolQuery;
}

export interface AgentHistoryQueryResponse {
  requestID: string;
  result?: IMHistoryToolResult;
  error?: string;
}

export interface AgentDeliveryAttachment {
  path: string;
  nativePath: string;
  fileName: string;
  kind: "file" | "image" | "folder";
  size?: number;
}

export interface AgentDeliveryRequest {
  requestID: string;
  sessionID: string;
  conversationID: string;
  messageID: string;
  text?: string;
  attachments: AgentDeliveryAttachment[];
}

export interface AgentDeliveryResponse {
  requestID: string;
  sessionID: string;
  messageID: string;
  textSent: boolean;
  sentAttachmentPaths: string[];
  errors?: string[];
}

export type AgentSessionEvent =
  | { type: "snapshot"; snapshot: AgentSessionStateSnapshot }
  | { type: "navigate"; conversationID: string; sessionID?: string }
  | { type: "history-query"; request: AgentHistoryQueryRequest }
  | { type: "delivery-request"; request: AgentDeliveryRequest };
