// Structured Agent Output Event types.
//
// These events are produced by the agent CLI (e.g. opencode) and written
// one JSON object per line (NDJSON) to `$WORKSPACE/.agent/events.ndjson`.
// The Electron main process watches this file and forwards parsed events
// to the renderer via the `agent:structuredOutput` IPC channel.

/** Discriminated union of all structured agent output events. */
export type AgentOutputEvent =
  | AgentProgressEvent
  | AgentFinalAnswerEvent
  | AgentArtifactEvent
  | AgentErrorEvent
  | AgentSessionEvent;

/** Progress update during agent execution. */
export interface AgentProgressEvent {
  type: "progress";
  /** Human-readable stage label (e.g. "analyzing", "generating"). */
  stage: string;
  /** Optional progress description. */
  message?: string;
  /** Optional completion percentage 0-100. */
  percent?: number;
}

/** Final answer produced by the agent. */
export interface AgentFinalAnswerEvent {
  type: "final_answer";
  /** The answer text. */
  text: string;
  /** Content format hint. */
  format?: "markdown" | "text" | "json";
  /** Optional session identifier. */
  sessionID?: string;
}

/** File artifact produced by the agent in the workspace. */
export interface AgentArtifactEvent {
  type: "artifact";
  /** Workspace-relative path to the artifact. */
  path: string;
  /** MIME type when known. */
  mime?: string;
  /** File size in bytes. */
  size?: number;
  /** Human-readable label. */
  label?: string;
}

/** Error encountered during agent execution. */
export interface AgentErrorEvent {
  type: "error";
  /** Human-readable error message. */
  message: string;
  /** Optional machine-readable error code. */
  code?: string;
}

/** Session lifecycle event. */
export interface AgentSessionEvent {
  type: "session";
  /** Session identifier. */
  id: string;
  /** Session status. */
  status: "started" | "completed" | "failed";
  /** Optional summary text on completion/failure. */
  summary?: string;
}

/** Type guard: checks if an unknown value is a valid AgentOutputEvent. */
export function isAgentOutputEvent(value: unknown): value is AgentOutputEvent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return false;

  switch (type) {
    case "progress":
      return typeof record.stage === "string";
    case "final_answer":
      return typeof record.text === "string";
    case "artifact":
      return typeof record.path === "string";
    case "error":
      return typeof record.message === "string";
    case "session":
      return (
        typeof record.id === "string" &&
        (record.status === "started" ||
          record.status === "completed" ||
          record.status === "failed")
      );
    default:
      return false;
  }
}

/**
 * Represents a buffered collection of structured events received for a
 * workspace tab, plus derived resolver state.
 */
export interface StructuredEventBuffer {
  events: AgentOutputEvent[];
  lastFinalAnswer?: AgentFinalAnswerEvent;
  lastSessionID?: string;
  artifacts: AgentArtifactEvent[];
  errors: AgentErrorEvent[];
  updatedAt: number;
}

/** Creates an empty event buffer. */
export function createStructuredEventBuffer(): StructuredEventBuffer {
  return {
    events: [],
    artifacts: [],
    errors: [],
    updatedAt: Date.now(),
  };
}
