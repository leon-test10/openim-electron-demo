import type {
  AgentInteraction,
  AgentMessage,
  AgentModelOption,
  AgentModelRef,
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
  message?: AgentMessage;
  part?: AgentMessage["parts"][number];
  messageID?: string;
  delta?: string;
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
  listModels(params: { workspacePath: string }): Promise<AgentModelOption[]>;
  send(params: {
    workspacePath: string;
    runtimeSessionID: string;
    prompt: string;
    messageID: string;
    model?: AgentModelRef;
    system?: string;
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
