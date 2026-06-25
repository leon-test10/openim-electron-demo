import { RuntimeProbeReport } from "../types";
import { extractOpenCodeAssistantMessage } from "./extractOpenCodeAssistantMessage";
import { OpenCodeServerClient } from "./OpenCodeServerClient";
import { createOpenCodeBinding } from "./OpenCodeSessionBinding";

const getSessionID = (session: unknown): string | undefined => {
  if (typeof session === "string") return session;
  if (!session || typeof session !== "object") return undefined;

  const record = session as Record<string, unknown>;
  return typeof record.id === "string"
    ? record.id
    : typeof record.sessionID === "string"
    ? record.sessionID
    : undefined;
};

export const probeOpenCodeSameSession = async (params: {
  workspaceRoot: string;
  serverBaseUrl: string;
}): Promise<RuntimeProbeReport> => {
  const client = new OpenCodeServerClient(params.serverBaseUrl);
  const reachable = await client.health();

  if (!reachable) {
    return {
      runtime: "opencode",
      serveCommandAvailable: false,
      configuredServerReachable: false,
      tuiAttachSupported: false,
      sessionListAvailable: false,
      sessionExportAvailable: false,
      sameSessionEvidence: "OpenCode server is not reachable.",
      binding: createOpenCodeBinding({
        workspaceRoot: params.workspaceRoot,
        serverBaseUrl: params.serverBaseUrl,
        mode: "tui-only",
        status: "failed",
        reason: "OpenCode server unavailable.",
      }),
    };
  }

  try {
    const sessions = await client.listSessions();
    const sessionID = getSessionID(sessions.at(-1));
    if (!sessionID) {
      return {
        runtime: "opencode",
        serveCommandAvailable: true,
        configuredServerReachable: true,
        tuiAttachSupported: false,
        sessionListAvailable: true,
        sessionExportAvailable: false,
        sameSessionEvidence: "Server is reachable but no active session was found.",
        binding: createOpenCodeBinding({
          workspaceRoot: params.workspaceRoot,
          serverBaseUrl: params.serverBaseUrl,
          mode: "tui-only",
          status: "degraded",
          reason: "No active OpenCode session found on the server.",
        }),
      };
    }

    const messages = await client.getSessionMessages(sessionID);
    const lastAssistantMessage = extractOpenCodeAssistantMessage(messages);
    return {
      runtime: "opencode",
      serveCommandAvailable: true,
      configuredServerReachable: true,
      tuiAttachSupported: true,
      sessionListAvailable: true,
      sessionExportAvailable: true,
      sameSessionEvidence: lastAssistantMessage
        ? "Server session messages include an assistant message."
        : "Server session exists, but no assistant message was found.",
      binding: createOpenCodeBinding({
        workspaceRoot: params.workspaceRoot,
        serverBaseUrl: params.serverBaseUrl,
        sessionID,
        mode: lastAssistantMessage ? "shared-server-session" : "tui-owned-session",
        status: lastAssistantMessage ? "bound" : "degraded",
        reason: lastAssistantMessage
          ? "OpenCode server/session messages are readable."
          : "OpenCode session readable, but no assistant reply is available.",
      }),
      lastAssistantMessage,
    };
  } catch (error) {
    return {
      runtime: "opencode",
      serveCommandAvailable: true,
      configuredServerReachable: true,
      tuiAttachSupported: false,
      sessionListAvailable: false,
      sessionExportAvailable: false,
      sameSessionEvidence:
        error instanceof Error ? error.message : "OpenCode session probe failed.",
      binding: createOpenCodeBinding({
        workspaceRoot: params.workspaceRoot,
        serverBaseUrl: params.serverBaseUrl,
        mode: "tui-only",
        status: "degraded",
        reason:
          error instanceof Error ? error.message : "OpenCode session probe failed.",
      }),
    };
  }
};
