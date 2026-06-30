import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { getCurrentAppConfig } from "./appConfig";
import { getTerminalWorkspaceDir } from "./workspaceManage";

type RuntimeBindingMode =
  | "shared-server-session"
  | "tui-owned-session"
  | "structured-run-separate-session"
  | "tui-only";

type RuntimeBindingStatus = "idle" | "probing" | "bound" | "degraded" | "failed";

type RuntimeSessionBinding = {
  runtime: "opencode";
  workspaceRoot: string;
  serverBaseUrl?: string;
  sessionID?: string;
  tuiProcessID?: string;
  mode: RuntimeBindingMode;
  status: RuntimeBindingStatus;
  reason?: string;
  lastCheckedAt?: number;
};

type RuntimeProbeReport = {
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
};

type ServerRecord = {
  workspaceID: string;
  process: ChildProcessWithoutNullStreams;
  baseUrl: string;
  startedAt: number;
};

const servers = new Map<string, ServerRecord>();
const bindings = new Map<string, RuntimeSessionBinding>();

const defaultHost = "127.0.0.1";
const defaultPort = 4096;

const createBinding = (
  workspaceRoot: string,
  patch: Partial<RuntimeSessionBinding> = {},
): RuntimeSessionBinding => ({
  runtime: "opencode",
  workspaceRoot,
  serverBaseUrl: patch.serverBaseUrl,
  sessionID: patch.sessionID,
  tuiProcessID: patch.tuiProcessID,
  mode: patch.mode ?? "tui-only",
  status: patch.status ?? "idle",
  reason: patch.reason,
  lastCheckedAt: Date.now(),
});

const fetchJSON = async (url: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
};

const joinUrl = (baseUrl: string, pathname: string) =>
  `${baseUrl.replace(/\/+$/, "")}${pathname}`;

const health = async (baseUrl: string) => {
  for (const pathname of ["/health", "/api/health", "/"]) {
    try {
      await fetchJSON(joinUrl(baseUrl, pathname));
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

const listSessions = async (baseUrl: string) => {
  for (const pathname of ["/sessions", "/session", "/api/sessions"]) {
    try {
      const response = await fetchJSON(joinUrl(baseUrl, pathname));
      if (Array.isArray(response)) return response;
      if (response && typeof response === "object") {
        const record = response as Record<string, unknown>;
        if (Array.isArray(record.sessions)) return record.sessions;
        if (Array.isArray(record.data)) return record.data;
        if (Array.isArray(record.items)) return record.items;
      }
    } catch {
      continue;
    }
  }

  throw new Error("OpenCode sessions API unavailable");
};

const getSessionID = (session: unknown) => {
  if (typeof session === "string") return session;
  if (!session || typeof session !== "object") return undefined;
  const record = session as Record<string, unknown>;
  return typeof record.id === "string"
    ? record.id
    : typeof record.sessionID === "string"
    ? record.sessionID
    : undefined;
};

const unwrapMessages = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["messages", "data", "items", "events", "result"]) {
    const messages = unwrapMessages(record[key]);
    if (messages.length > 0) return messages;
  }
  return [];
};

const getSessionMessages = async (baseUrl: string, sessionID: string) => {
  const encodedSessionID = encodeURIComponent(sessionID);
  for (const pathname of [
    `/sessions/${encodedSessionID}/messages`,
    `/session/${encodedSessionID}/messages`,
    `/api/sessions/${encodedSessionID}/messages`,
    `/sessions/${encodedSessionID}`,
    `/session/${encodedSessionID}`,
  ]) {
    try {
      const response = await fetchJSON(joinUrl(baseUrl, pathname));
      const messages = unwrapMessages(response);
      if (messages.length > 0) return messages;
    } catch {
      continue;
    }
  }
  throw new Error("OpenCode session messages unavailable");
};

const extractText = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractText(item))
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
    return text || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "markdown", "answer"]) {
    const text = extractText(record[key]);
    if (text) return text;
  }
  return undefined;
};

const extractAssistantMessage = (messages: Record<string, unknown>[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = String(
      message.role ?? message.type ?? message.kind ?? "",
    ).toLowerCase();
    if (
      !role.includes("assistant") &&
      !role.includes("agent") &&
      !role.includes("final_answer")
    ) {
      continue;
    }
    const text = extractText(message);
    if (text) return text;
  }
  return undefined;
};

const buildFailedReport = (
  workspaceRoot: string,
  baseUrl: string,
  reason: string,
): RuntimeProbeReport => ({
  runtime: "opencode",
  serveCommandAvailable: false,
  configuredServerReachable: false,
  tuiAttachSupported: false,
  sessionListAvailable: false,
  sessionExportAvailable: false,
  sameSessionEvidence: reason,
  binding: createBinding(workspaceRoot, {
    serverBaseUrl: baseUrl,
    mode: "tui-only",
    status: "failed",
    reason,
  }),
});

export const opencodeManager = {
  async probeServer(params: {
    workspaceID: string;
    port?: number;
    hostname?: string;
  }): Promise<RuntimeProbeReport> {
    const workspaceRoot = await getTerminalWorkspaceDir(params.workspaceID);
    const appConfig = getCurrentAppConfig();
    const hostname = params.hostname || appConfig.opencode.serverHost || defaultHost;
    const port = params.port || appConfig.opencode.serverPort || defaultPort;
    const baseUrl = `http://${hostname}:${port}`;

    if (hostname !== defaultHost) {
      return buildFailedReport(
        workspaceRoot,
        baseUrl,
        "OpenCode probe only allows 127.0.0.1 in P10.0.",
      );
    }

    const serverReachable = await health(baseUrl);
    if (!serverReachable) {
      const report = buildFailedReport(
        workspaceRoot,
        baseUrl,
        "OpenCode server unavailable.",
      );
      bindings.set(params.workspaceID, report.binding);
      return report;
    }

    try {
      const sessions = await listSessions(baseUrl);
      const sessionID = getSessionID(sessions.at(-1));
      if (!sessionID) {
        const binding = createBinding(workspaceRoot, {
          serverBaseUrl: baseUrl,
          mode: "tui-only",
          status: "degraded",
          reason: "Server reachable, but no active OpenCode session was found.",
        });
        bindings.set(params.workspaceID, binding);
        return {
          runtime: "opencode",
          serveCommandAvailable: true,
          configuredServerReachable: true,
          tuiAttachSupported: false,
          sessionListAvailable: true,
          sessionExportAvailable: false,
          sameSessionEvidence: binding.reason!,
          binding,
        };
      }

      const messages = await getSessionMessages(baseUrl, sessionID);
      const lastAssistantMessage = extractAssistantMessage(messages);
      const binding = createBinding(workspaceRoot, {
        serverBaseUrl: baseUrl,
        sessionID,
        mode: lastAssistantMessage ? "shared-server-session" : "tui-owned-session",
        status: lastAssistantMessage ? "bound" : "degraded",
        reason: lastAssistantMessage
          ? "OpenCode server/session messages are readable."
          : "OpenCode session readable, but no assistant message is available.",
      });
      bindings.set(params.workspaceID, binding);
      return {
        runtime: "opencode",
        serveCommandAvailable: true,
        configuredServerReachable: true,
        tuiAttachSupported: true,
        sessionListAvailable: true,
        sessionExportAvailable: true,
        sameSessionEvidence: binding.reason!,
        binding,
        lastAssistantMessage,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "OpenCode probe failed.";
      const binding = createBinding(workspaceRoot, {
        serverBaseUrl: baseUrl,
        mode: "tui-only",
        status: "degraded",
        reason,
      });
      bindings.set(params.workspaceID, binding);
      return {
        runtime: "opencode",
        serveCommandAvailable: true,
        configuredServerReachable: true,
        tuiAttachSupported: false,
        sessionListAvailable: false,
        sessionExportAvailable: false,
        sameSessionEvidence: reason,
        binding,
      };
    }
  },

  async startServer(params: {
    workspaceID: string;
    port?: number;
    hostname?: string;
  }) {
    const appConfig = getCurrentAppConfig();
    const hostname = params.hostname || appConfig.opencode.serverHost || defaultHost;
    const port = params.port || appConfig.opencode.serverPort || defaultPort;
    if (hostname !== defaultHost) {
      throw new Error("OpenCode server is limited to 127.0.0.1 in P10.0.");
    }

    const existing = servers.get(params.workspaceID);
    if (existing && !existing.process.killed) {
      return {
        ok: true,
        baseUrl: existing.baseUrl,
        alreadyRunning: true,
      };
    }

    const workspaceRoot = await getTerminalWorkspaceDir(params.workspaceID);
    const opencodeArgs = [
      ...(appConfig.opencode.args || []),
      "serve",
      "--port",
      String(port),
      "--hostname",
      hostname,
    ];
    const child = spawn(
      appConfig.opencode.command || "opencode",
      opencodeArgs,
      {
        cwd: workspaceRoot,
        windowsHide: true,
        shell: process.platform === "win32",
        env: {
          ...process.env,
          OPENAI_BASE_URL: appConfig.llm.baseUrl,
          OPENAI_API_KEY: appConfig.llm.apiKey,
        },
      },
    );
    const baseUrl = `http://${hostname}:${port}`;

    servers.set(params.workspaceID, {
      workspaceID: params.workspaceID,
      process: child,
      baseUrl,
      startedAt: Date.now(),
    });
    bindings.set(
      params.workspaceID,
      createBinding(workspaceRoot, {
        serverBaseUrl: baseUrl,
        mode: "tui-only",
        status: "probing",
        reason: "OpenCode server process started; run probe to verify sessions.",
      }),
    );

    child.once("exit", () => {
      servers.delete(params.workspaceID);
    });

    return {
      ok: true,
      baseUrl,
      pid: child.pid,
    };
  },

  stopServer(workspaceID: string) {
    const existing = servers.get(workspaceID);
    if (!existing) return { ok: true, stopped: false };

    existing.process.kill();
    servers.delete(workspaceID);
    return { ok: true, stopped: true };
  },

  async getBinding(workspaceID: string) {
    const existing = bindings.get(workspaceID);
    if (existing) return existing;

    const workspaceRoot = await getTerminalWorkspaceDir(workspaceID);
    return createBinding(workspaceRoot, {
      mode: "tui-only",
      status: "idle",
      reason: "OpenCode same-session probe has not run.",
    });
  },

  stopAll() {
    for (const record of servers.values()) {
      record.process.kill();
    }
    servers.clear();
  },
};
