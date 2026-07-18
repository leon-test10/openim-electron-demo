import type { AgentRuntimeID } from "./identity";
import { OPENIM_AGENT_PROTOCOL_VERSION } from "./protocol";
import type {
  AgentInteraction,
  AgentMessage,
  AgentModelOption,
  AgentModelRef,
  AgentSessionStatus,
} from "./sessionTypes";

export type AgentRuntimeTransport =
  | "embedded-api"
  | "stdio"
  | "websocket"
  | "http-provider";

export type AgentRuntimeCapability =
  | "session.create"
  | "session.restore"
  | "session.history"
  | "run.execute"
  | "run.abort"
  | "run.streaming"
  | "interaction.permission"
  | "interaction.question"
  | "model.list"
  | "artifact.publish"
  | "history.query";

export interface AgentRuntimeDescriptor {
  id: AgentRuntimeID;
  displayName: string;
  protocolVersion: typeof OPENIM_AGENT_PROTOCOL_VERSION;
  transport: AgentRuntimeTransport;
  capabilities: readonly AgentRuntimeCapability[];
}

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
  readonly descriptor: AgentRuntimeDescriptor;
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

const validateDescriptor = (descriptor: AgentRuntimeDescriptor) => {
  if (!descriptor.id.trim()) throw new Error("Runtime descriptor requires an id");
  if (!descriptor.displayName.trim()) {
    throw new Error(`Runtime ${descriptor.id} requires a display name`);
  }
  if (descriptor.protocolVersion !== OPENIM_AGENT_PROTOCOL_VERSION) {
    throw new Error(
      `Runtime ${descriptor.id} uses unsupported protocol version ${descriptor.protocolVersion}`,
    );
  }
  if (new Set(descriptor.capabilities).size !== descriptor.capabilities.length) {
    throw new Error(`Runtime ${descriptor.id} declares duplicate capabilities`);
  }
};

export class AgentRuntimeRegistry {
  private readonly adapters = new Map<AgentRuntimeID, AgentRuntimeAdapter>();

  register(adapter: AgentRuntimeAdapter) {
    validateDescriptor(adapter.descriptor);
    if (this.adapters.has(adapter.descriptor.id)) {
      throw new Error(`Runtime already registered: ${adapter.descriptor.id}`);
    }
    this.adapters.set(adapter.descriptor.id, adapter);
    return adapter;
  }

  unregister(runtimeID: AgentRuntimeID) {
    return this.adapters.delete(runtimeID);
  }

  get(runtimeID: AgentRuntimeID) {
    return this.adapters.get(runtimeID);
  }

  require(runtimeID: AgentRuntimeID) {
    const adapter = this.get(runtimeID);
    if (!adapter) throw new Error(`Runtime is not registered: ${runtimeID}`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()]
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  supports(runtimeID: AgentRuntimeID, capability: AgentRuntimeCapability) {
    return this.require(runtimeID).descriptor.capabilities.includes(capability);
  }
}
