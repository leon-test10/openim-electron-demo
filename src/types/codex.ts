export type CodexConversationState =
  | "unknown"
  | "idle"
  | "queued"
  | "running"
  | "cancelling"
  | "failed"
  | "completed";

export type CodexJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CodexFailureReason =
  | "codex_exit"
  | "timeout"
  | "bridge_error"
  | "openim_send_failed"
  | "missing_session";

export interface CodexSessionRecord {
  id: string;
  openimConversationId: string;
  openimDisplayUserId: string;
  codexSessionId: string | null;
  codexProjectPath: string;
  codexHomeDir: string | null;
  codexHomeSeedMode: "copy-auth-only" | "copy-auth-and-config" | "none" | null;
  sandboxMode: string | null;
  displayName: string | null;
  displayNameSource: "auto" | "manual" | null;
  lastSummary: string | null;
  isActive: boolean;
  status: "active" | "paused" | "archived" | "error";
  parentSessionRecordId: string | null;
  forkedFromCodexSessionId: string | null;
  createdReason: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodexBridgeMeta {
  name: string;
  version: string;
  apiVersion: string;
  capabilities: {
    sessionMetadata?: boolean;
    sessionActivate?: boolean;
    sessionRename?: boolean;
    sessionArchive?: boolean;
    runtimeEvents?: boolean;
    jobCancel?: boolean;
    jobRetry?: boolean;
  };
}

export interface CodexRuntimeJob {
  id: string;
  sessionRecordId: string;
  semanticEventId: string;
  openimConversationId: string;
  status: CodexJobStatus;
  inputText: string;
  codexSessionIdBefore: string | null;
  codexSessionIdAfter: string | null;
  outputText: string | null;
  errorText: string | null;
  failureReason: CodexFailureReason | null;
  retryOfJobId: string | null;
  cancelRequestedAt: number | null;
  cancelledAt: number | null;
  cancelMethod: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  queuedMs?: number | null;
  runningMs?: number | null;
  totalMs?: number | null;
  runningForMs?: number | null;
  totalDurationMs?: number | null;
  canCancel?: boolean;
  canRetry?: boolean;
}

export interface CodexRuntimeEvent {
  id: string;
  jobId: string;
  sessionRecordId: string;
  openimConversationId: string;
  sequence: number;
  eventType: string;
  title: string;
  summary: string | null;
  rawEvent: Record<string, unknown>;
  createdAt: number;
}

export interface CodexConversationStatus {
  openimConversationId: string;
  state: CodexConversationState;
  activeSession: CodexSessionRecord | null;
  activeJob: CodexRuntimeJob | null;
  latestJob: CodexRuntimeJob | null;
  recentJobs: CodexRuntimeJob[];
  queuedJobCount: number;
}

export interface CodexBindingDetail {
  openimConversationId: string;
  activeSession: CodexSessionRecord;
  sessions: CodexSessionRecord[];
  activeJob: CodexRuntimeJob | null;
  latestJob: CodexRuntimeJob | null;
  recentJobs: CodexRuntimeJob[];
}

export interface RebindCodexInput {
  openimDisplayUserId?: string;
  userId?: string;
  codexProjectPath?: string;
  codexSessionId?: string;
}

export interface CreateCodexSessionInput {
  openimDisplayUserId?: string;
  userId?: string;
  codexProjectPath?: string;
  displayName?: string;
}
