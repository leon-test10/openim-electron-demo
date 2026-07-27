export type AgentSessionStatus =
  | "creating"
  | "idle"
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "error"
  | "disconnected"
  | "recovery_required"
  | "archived";

export type AgentMessageRole = "user" | "assistant" | "system" | "tool";

export interface AgentMessagePart {
  id: string;
  type: "text" | "reasoning" | "tool" | "file" | "error";
  text?: string;
  name?: string;
  path?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  sessionID: string;
  role: AgentMessageRole;
  createdAt: number;
  completedAt?: number;
  parts: AgentMessagePart[];
}

export interface AgentModelRef {
  providerID: string;
  modelID: string;
}

export interface AgentModelOption extends AgentModelRef {
  providerName: string;
  modelName: string;
  isDefault: boolean;
}

export interface AgentPermissionInteraction {
  id: string;
  type: "permission";
  sessionID: string;
  runID?: string;
  agentRequestID?: string;
  permission: string;
  patterns: string[];
  always: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestionInfo {
  header?: string;
  question: string;
  options: AgentQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface AgentQuestionInteraction {
  id: string;
  type: "question";
  sessionID: string;
  runID?: string;
  agentRequestID?: string;
  questions: AgentQuestionInfo[];
  createdAt: number;
}

export type AgentInteraction = AgentPermissionInteraction | AgentQuestionInteraction;
