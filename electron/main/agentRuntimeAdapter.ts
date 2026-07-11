import type {
  AgentInteraction,
  AgentMessage,
  AgentSessionStatus,
} from "../../src/types/agentSession";

export interface RuntimeSessionRecord {
  runtimeSessionID: string;
  title?: string;
  status: AgentSessionStatus;
  messages: AgentMessage[];
  interactions: AgentInteraction[];
}

export interface RuntimeSessionEvent {
  runtimeSessionID?: string;
  directory?: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface AgentRuntimeAdapter {
  ensureRuntime(): Promise<{ baseUrl: string }>;
  createSession(params: {
    workspacePath: string;
    title: string;
  }): Promise<RuntimeSessionRecord>;
  restoreSession(params: {
    workspacePath: string;
    runtimeSessionID: string;
  }): Promise<RuntimeSessionRecord | undefined>;
  listMessages(params: {
    workspacePath: string;
    runtimeSessionID: string;
  }): Promise<AgentMessage[]>;
  send(params: {
    workspacePath: string;
    runtimeSessionID: string;
    prompt: string;
    messageID: string;
  }): Promise<void>;
  abort(params: { workspacePath: string; runtimeSessionID: string }): Promise<void>;
  replyPermission(params: {
    workspacePath: string;
    requestID: string;
    reply: "once" | "always" | "reject";
    message?: string;
  }): Promise<void>;
  replyQuestion(params: {
    workspacePath: string;
    requestID: string;
    answers?: string[][];
    reject?: boolean;
  }): Promise<void>;
  subscribe(listener: (event: RuntimeSessionEvent) => void): () => void;
  stop(): void;
}
