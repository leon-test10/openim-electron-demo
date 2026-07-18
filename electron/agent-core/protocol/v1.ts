export const OPENIM_AGENT_PROTOCOL_VERSION = 1 as const;

export type OpenIMAgentProtocolVersion = typeof OPENIM_AGENT_PROTOCOL_VERSION;

export type AgentProtocolMethod =
  | "agent.connect"
  | "agent.status"
  | "session.create"
  | "session.restore"
  | "session.messages"
  | "model.list"
  | "run.start"
  | "run.abort"
  | "permission.reply"
  | "question.reply"
  | "artifact.publish"
  | "delivery.result";

export type AgentProtocolEventName =
  | "agent.presence"
  | "session.updated"
  | "run.event"
  | "permission.request"
  | "question.request"
  | "artifact.published"
  | "delivery.request";

export type AgentRunEventState =
  | "queued"
  | "running"
  | "delta"
  | "tool_call_start"
  | "tool_call_end"
  | "waiting_permission"
  | "waiting_question"
  | "final"
  | "error"
  | "aborted";

export type AgentProtocolErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unsupported_capability"
  | "unsupported_protocol_version"
  | "unavailable"
  | "timeout"
  | "internal_error";

export interface AgentProtocolError {
  code: AgentProtocolErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

interface AgentProtocolFrameBase {
  protocolVersion: OpenIMAgentProtocolVersion;
  timestamp: number;
}

export interface AgentProtocolRequestFrame extends AgentProtocolFrameBase {
  type: "req";
  id: string;
  method: AgentProtocolMethod;
  params: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface AgentProtocolResponseFrame extends AgentProtocolFrameBase {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: AgentProtocolError;
}

export interface AgentProtocolEventFrame extends AgentProtocolFrameBase {
  type: "event";
  event: AgentProtocolEventName;
  eventID: string;
  sequence: number;
  conversationID?: string;
  sessionID?: string;
  runID?: string;
  sourceAgentID?: string;
  sourceRuntimeID?: string;
  payload: Record<string, unknown>;
}

export type AgentProtocolFrame =
  | AgentProtocolRequestFrame
  | AgentProtocolResponseFrame
  | AgentProtocolEventFrame;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const protocolMethods: readonly AgentProtocolMethod[] = [
  "agent.connect",
  "agent.status",
  "session.create",
  "session.restore",
  "session.messages",
  "model.list",
  "run.start",
  "run.abort",
  "permission.reply",
  "question.reply",
  "artifact.publish",
  "delivery.result",
];

const protocolEvents: readonly AgentProtocolEventName[] = [
  "agent.presence",
  "session.updated",
  "run.event",
  "permission.request",
  "question.request",
  "artifact.published",
  "delivery.request",
];

const isProtocolMethod = (value: unknown): value is AgentProtocolMethod =>
  typeof value === "string" && protocolMethods.includes(value as AgentProtocolMethod);

const isProtocolEvent = (value: unknown): value is AgentProtocolEventName =>
  typeof value === "string" && protocolEvents.includes(value as AgentProtocolEventName);

export const isTerminalRunEventState = (state: AgentRunEventState) =>
  state === "final" || state === "error" || state === "aborted";

export const parseAgentProtocolFrame = (value: unknown): AgentProtocolFrame => {
  if (!isRecord(value)) throw new Error("Agent protocol frame must be an object");
  if (value.protocolVersion !== OPENIM_AGENT_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported agent protocol version: ${String(value.protocolVersion)}`,
    );
  }
  if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) {
    throw new Error("Agent protocol frame requires a numeric timestamp");
  }

  if (value.type === "req") {
    if (!isNonEmptyString(value.id) || !isProtocolMethod(value.method)) {
      throw new Error("Agent protocol request requires id and method");
    }
    if (!isRecord(value.params)) {
      throw new Error("Agent protocol request params must be an object");
    }
    return value as unknown as AgentProtocolRequestFrame;
  }

  if (value.type === "res") {
    if (!isNonEmptyString(value.id) || typeof value.ok !== "boolean") {
      throw new Error("Agent protocol response requires id and ok");
    }
    if (value.ok === false && !isRecord(value.error)) {
      throw new Error("Failed agent protocol response requires an error");
    }
    return value as unknown as AgentProtocolResponseFrame;
  }

  if (value.type === "event") {
    if (!isProtocolEvent(value.event) || !isNonEmptyString(value.eventID)) {
      throw new Error("Agent protocol event requires event and eventID");
    }
    if (
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    ) {
      throw new Error("Agent protocol event requires a non-negative integer sequence");
    }
    if (!isRecord(value.payload)) {
      throw new Error("Agent protocol event payload must be an object");
    }
    return value as unknown as AgentProtocolEventFrame;
  }

  throw new Error(`Unknown agent protocol frame type: ${String(value.type)}`);
};
