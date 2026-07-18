import type { AgentProtocolClient } from "./client";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeDescriptor,
  RuntimeSessionRecord,
} from "./runtime";
import type {
  AgentInteraction,
  AgentMessage,
  AgentModelOption,
  AgentSessionStatus,
} from "./sessionTypes";

const sessionStatuses: readonly AgentSessionStatus[] = [
  "creating",
  "idle",
  "running",
  "waiting_permission",
  "waiting_question",
  "error",
  "disconnected",
  "recovery_required",
  "archived",
];

const parseSession = (
  value: Record<string, unknown>,
  operation: string,
): RuntimeSessionRecord => {
  if (typeof value.runtimeSessionID !== "string" || !value.runtimeSessionID) {
    throw new Error(`${operation} response requires runtimeSessionID`);
  }
  if (
    typeof value.status !== "string" ||
    !sessionStatuses.includes(value.status as AgentSessionStatus)
  ) {
    throw new Error(`${operation} response requires a valid session status`);
  }
  return {
    runtimeSessionID: value.runtimeSessionID,
    title: typeof value.title === "string" ? value.title : undefined,
    status: value.status as AgentSessionStatus,
    messages: Array.isArray(value.messages) ? (value.messages as AgentMessage[]) : [],
    interactions: Array.isArray(value.interactions)
      ? (value.interactions as AgentInteraction[])
      : [],
  };
};

const requireArray = <T>(
  payload: Record<string, unknown>,
  key: string,
  operation: string,
) => {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new Error(`${operation} response requires ${key}`);
  }
  return value as T[];
};

export class AgentProviderRuntimeAdapter implements AgentRuntimeAdapter {
  constructor(
    readonly descriptor: AgentRuntimeDescriptor,
    private readonly client: AgentProtocolClient,
  ) {}

  async ensureRuntime() {
    await this.client.connect();
    return { baseUrl: this.client.endpoint };
  }

  async createSession(params: { workspacePath: string; title: string }) {
    return parseSession(
      await this.client.request("session.create", params),
      "session.create",
    );
  }

  async restoreSession(params: { workspacePath: string; runtimeSessionID: string }) {
    const payload = await this.client.request("session.restore", params);
    if (payload.found === false) return undefined;
    return parseSession(payload, "session.restore");
  }

  async listMessages(params: { workspacePath: string; runtimeSessionID: string }) {
    const payload = await this.client.request("session.messages", params);
    return requireArray<AgentMessage>(payload, "messages", "session.messages");
  }

  async listModels(params: { workspacePath: string }) {
    const payload = await this.client.request("model.list", params);
    return requireArray<AgentModelOption>(payload, "models", "model.list");
  }

  async send(params: {
    workspacePath: string;
    runtimeSessionID: string;
    prompt: string;
    messageID: string;
    model?: { providerID: string; modelID: string };
    system?: string;
  }) {
    await this.client.request("run.start", params, {
      idempotencyKey: params.messageID,
    });
  }

  async abort(params: { workspacePath: string; runtimeSessionID: string }) {
    await this.client.request("run.abort", params);
  }

  async replyPermission(params: {
    workspacePath: string;
    requestID: string;
    reply: "once" | "always" | "reject";
    message?: string;
  }) {
    await this.client.request("permission.reply", params);
  }

  async replyQuestion(params: {
    workspacePath: string;
    requestID: string;
    answers?: string[][];
    reject?: boolean;
  }) {
    await this.client.request("question.reply", params);
  }

  subscribe(listener: Parameters<AgentRuntimeAdapter["subscribe"]>[0]) {
    return this.client.subscribe((event) => {
      listener({
        runtimeSessionID: event.sessionID,
        type: event.event,
        payload: {
          ...event.payload,
          eventID: event.eventID,
          sequence: event.sequence,
          conversationID: event.conversationID,
          runID: event.runID,
          sourceAgentID: event.sourceAgentID,
          sourceRuntimeID: event.sourceRuntimeID,
        },
      });
    });
  }

  stop() {
    this.client.close();
  }
}
