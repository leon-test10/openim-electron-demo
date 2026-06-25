import { RuntimeSessionBinding } from "../types";

export const createOpenCodeBinding = (
  patch: Partial<RuntimeSessionBinding> & { workspaceRoot: string },
): RuntimeSessionBinding => ({
  runtime: "opencode",
  workspaceRoot: patch.workspaceRoot,
  serverBaseUrl: patch.serverBaseUrl,
  sessionID: patch.sessionID,
  tuiProcessID: patch.tuiProcessID,
  mode: patch.mode ?? "tui-only",
  status: patch.status ?? "idle",
  reason: patch.reason,
  lastCheckedAt: patch.lastCheckedAt ?? Date.now(),
});
