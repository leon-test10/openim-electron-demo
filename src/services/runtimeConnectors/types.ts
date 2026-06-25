export type RuntimeBindingMode =
  | "shared-server-session"
  | "tui-owned-session"
  | "structured-run-separate-session"
  | "tui-only";

export type RuntimeBindingStatus = "idle" | "probing" | "bound" | "degraded" | "failed";

export interface RuntimeSessionBinding {
  runtime: "opencode";
  workspaceRoot: string;
  serverBaseUrl?: string;
  sessionID?: string;
  tuiProcessID?: string;
  mode: RuntimeBindingMode;
  status: RuntimeBindingStatus;
  reason?: string;
  lastCheckedAt?: number;
}

export interface RuntimeProbeReport {
  runtime: "opencode";
  version?: string;
  serveCommandAvailable: boolean;
  configuredServerReachable: boolean;
  tuiAttachSupported: boolean;
  sessionListAvailable: boolean;
  sessionExportAvailable: boolean;
  sameSessionEvidence: string;
  binding: RuntimeSessionBinding;
  lastAssistantMessage?: string;
}
