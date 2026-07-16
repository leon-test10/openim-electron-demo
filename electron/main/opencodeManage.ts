import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

import type {
  AgentInteraction,
  AgentMessage,
  AgentMessagePart,
  AgentModelOption,
  AgentSessionStatus,
} from "../../src/types/agentSession";
import type {
  AgentRuntimeAdapter,
  RuntimeSessionEvent,
  RuntimeSessionRecord,
} from "./agentRuntimeAdapter";
import { getCurrentAppConfig } from "./appConfig";
import { getTerminalWorkspaceDir } from "./workspaceManage";
import {
  fetchOpenCode,
  parseOpenCodeSSEBlock,
  requestOpenCodeJSON,
} from "./opencodeHttp";

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
  process?: ChildProcessWithoutNullStreams;
  baseUrl: string;
  owned: boolean;
};

const listeners = new Set<(event: RuntimeSessionEvent) => void>();
const bindings = new Map<string, RuntimeSessionBinding>();
let server: ServerRecord | undefined;
let ensureServerPromise: Promise<ServerRecord> | undefined;
let eventAbort: AbortController | undefined;
let eventLoopGeneration = 0;
let eventStreamConnected = false;
let eventStreamConnectedBefore = false;
let lastHealthError = "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const unwrapData = (value: unknown) =>
  isRecord(value) && "data" in value ? value.data : value;

const fetchWithTimeout = async (
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchOpenCode(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const health = async (baseUrl: string) => {
  for (const pathname of ["/global/health", "/health", "/"]) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${pathname}`, undefined, 1500);
      if (response.ok) {
        lastHealthError = "";
        return true;
      }
      lastHealthError = `${pathname} returned ${response.status}`;
    } catch (error) {
      lastHealthError = error instanceof Error ? error.message : String(error);
      continue;
    }
  }
  return false;
};

const findAvailablePort = (preferred: number) =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : 0;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => {
      probe.close(() => resolve(preferred));
    });
  });

const query = (
  directory: string,
  extra?: Record<string, string | number | undefined>,
) => {
  const params = new URLSearchParams({ directory });
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  return `?${params.toString()}`;
};

const extractSessionID = (value: unknown): string | undefined => {
  const data = unwrapData(value);
  if (typeof data === "string") return data;
  if (!isRecord(data)) return undefined;
  for (const key of ["id", "sessionID", "sessionId"]) {
    if (typeof data[key] === "string") return data[key] as string;
  }
  return undefined;
};

const extractText = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const text = value
      .map(extractText)
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ["text", "content", "message", "output", "error"]) {
    const text = extractText(value[key]);
    if (text) return text;
  }
  return undefined;
};

const normalizePart = (
  value: unknown,
  fallbackID: string,
): AgentMessagePart | undefined => {
  if (!isRecord(value)) return undefined;
  const type = String(value.type ?? "text");
  const id = typeof value.id === "string" ? value.id : fallbackID;
  if (type === "text") {
    return {
      id,
      type: "text",
      text: typeof value.text === "string" ? value.text : extractText(value),
    };
  }
  if (type === "reasoning") {
    return {
      id,
      type: "reasoning",
      text: typeof value.text === "string" ? value.text : extractText(value),
    };
  }
  if (type === "file") {
    return {
      id,
      type: "file",
      name: typeof value.filename === "string" ? value.filename : undefined,
      path: typeof value.url === "string" ? value.url : undefined,
      metadata: value,
    };
  }
  if (type === "tool") {
    const state = isRecord(value.state) ? value.state : undefined;
    return {
      id,
      type: "tool",
      name: typeof value.tool === "string" ? value.tool : "tool",
      status: typeof state?.status === "string" ? state.status : undefined,
      text: extractText(state?.output ?? state?.error),
      metadata: value,
    };
  }
  if (type.includes("error") || value.error) {
    return { id, type: "error", text: extractText(value), metadata: value };
  }
  return undefined;
};

const normalizeMessage = (value: unknown, index: number): AgentMessage | undefined => {
  if (!isRecord(value)) return undefined;
  const info = isRecord(value.info) ? value.info : value;
  const id =
    typeof info.id === "string"
      ? info.id
      : typeof value.id === "string"
      ? value.id
      : `opencode_message_${index}`;
  const sessionID = String(info.sessionID ?? value.sessionID ?? "");
  if (!sessionID) return undefined;
  const roleValue = String(info.role ?? value.role ?? "assistant");
  const role: AgentMessage["role"] =
    roleValue === "user"
      ? "user"
      : roleValue === "system"
      ? "system"
      : roleValue === "tool"
      ? "tool"
      : "assistant";
  const rawParts = Array.isArray(value.parts)
    ? value.parts
    : Array.isArray(info.parts)
    ? info.parts
    : [];
  const parts = rawParts
    .map((part, partIndex) => normalizePart(part, `${id}_part_${partIndex}`))
    .filter((part): part is AgentMessagePart => Boolean(part));
  const fallbackText = extractText(value);
  if (parts.length === 0 && fallbackText) {
    parts.push({ id: `${id}_text`, type: "text", text: fallbackText });
  }
  const time = isRecord(info.time) ? info.time : undefined;
  return {
    id,
    sessionID,
    role,
    createdAt:
      typeof time?.created === "number"
        ? time.created
        : typeof info.createdAt === "number"
        ? info.createdAt
        : Date.now(),
    completedAt: typeof time?.completed === "number" ? time.completed : undefined,
    parts,
  };
};

const normalizeMessages = (value: unknown) => {
  const data = unwrapData(value);
  const items = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.messages)
    ? data.messages
    : [];
  return items
    .map(normalizeMessage)
    .filter((message): message is AgentMessage => Boolean(message));
};

const normalizePermission = (value: unknown): AgentInteraction | undefined => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sessionID !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    type: "permission",
    sessionID: value.sessionID,
    permission: String(value.permission ?? "permission"),
    patterns: Array.isArray(value.patterns) ? value.patterns.map(String) : [],
    always: Array.isArray(value.always) ? value.always.map(String) : [],
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    createdAt: Date.now(),
  };
};

const normalizeQuestion = (value: unknown): AgentInteraction | undefined => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sessionID !== "string"
  ) {
    return undefined;
  }
  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];
  return {
    id: value.id,
    type: "question",
    sessionID: value.sessionID,
    questions: rawQuestions.filter(isRecord).map((item) => ({
      header: typeof item.header === "string" ? item.header : undefined,
      question: String(item.question ?? "Agent question"),
      options: Array.isArray(item.options)
        ? item.options.filter(isRecord).map((option) => ({
            label: String(option.label ?? "Option"),
            description:
              typeof option.description === "string" ? option.description : undefined,
          }))
        : [],
      multiple: Boolean(item.multiple),
      custom: Boolean(item.custom),
    })),
    createdAt: Date.now(),
  };
};

const sessionStatus = async (
  baseUrl: string,
  workspacePath: string,
  runtimeSessionID: string,
): Promise<AgentSessionStatus> => {
  try {
    const value = unwrapData(
      await requestOpenCodeJSON(baseUrl, `/session/status${query(workspacePath)}`),
    );
    if (!isRecord(value)) return "idle";
    const status = value[runtimeSessionID];
    const type = isRecord(status) ? status.type : status;
    return type === "busy" || type === "retry" ? "running" : "idle";
  } catch {
    return "idle";
  }
};

const pendingInteractions = async (
  baseUrl: string,
  workspacePath: string,
  runtimeSessionID: string,
) => {
  const results = await Promise.allSettled([
    requestOpenCodeJSON(baseUrl, `/permission${query(workspacePath)}`),
    requestOpenCodeJSON(baseUrl, `/question${query(workspacePath)}`),
  ]);
  const permissionData =
    results[0].status === "fulfilled" ? unwrapData(results[0].value) : [];
  const questionData =
    results[1].status === "fulfilled" ? unwrapData(results[1].value) : [];
  return [
    ...(Array.isArray(permissionData) ? permissionData : [])
      .map(normalizePermission)
      .filter((item): item is AgentInteraction => Boolean(item)),
    ...(Array.isArray(questionData) ? questionData : [])
      .map(normalizeQuestion)
      .filter((item): item is AgentInteraction => Boolean(item)),
  ].filter((item) => item.sessionID === runtimeSessionID);
};

const emitSSE = (raw: unknown) => {
  if (!isRecord(raw)) return;
  const wrapper = isRecord(raw.payload) ? raw : undefined;
  const payload = wrapper ? wrapper.payload : raw;
  if (!isRecord(payload) || typeof payload.type !== "string") return;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const info = isRecord(properties.info) ? properties.info : undefined;
  const part = isRecord(properties.part) ? properties.part : undefined;
  const runtimeSessionID =
    typeof properties.sessionID === "string"
      ? properties.sessionID
      : typeof info?.sessionID === "string"
      ? info.sessionID
      : typeof part?.sessionID === "string"
      ? part.sessionID
      : undefined;
  const event: RuntimeSessionEvent = {
    runtimeSessionID,
    directory:
      wrapper && typeof wrapper.directory === "string" ? wrapper.directory : undefined,
    type: payload.type,
    payload: properties,
    message: info ? normalizeMessage({ info }, 0) : undefined,
    part: part ? normalizePart(part, `stream_part_${Date.now()}`) : undefined,
    messageID:
      typeof part?.messageID === "string"
        ? part.messageID
        : typeof properties.messageID === "string"
        ? properties.messageID
        : undefined,
    delta: typeof properties.delta === "string" ? properties.delta : undefined,
  };
  listeners.forEach((listener) => listener(event));
};

const startEventLoop = (baseUrl: string) => {
  eventAbort?.abort();
  const generation = ++eventLoopGeneration;
  eventAbort = new AbortController();
  const controller = eventAbort;

  const run = async () => {
    while (generation === eventLoopGeneration && !controller.signal.aborted) {
      const attemptController = new AbortController();
      const abortAttempt = () => attemptController.abort();
      controller.signal.addEventListener("abort", abortAttempt, { once: true });
      try {
        const response = await fetchOpenCode(`${baseUrl}/global/event`, {
          headers: { Accept: "text/event-stream" },
          signal: attemptController.signal,
        });
        if (!response.ok || !response.body)
          throw new Error("OpenCode event stream unavailable");
        if (!eventStreamConnected && eventStreamConnectedBefore) {
          listeners.forEach((listener) =>
            listener({
              type: "runtime.connected",
              payload: { baseUrl },
            }),
          );
        }
        eventStreamConnected = true;
        eventStreamConnectedBefore = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!attemptController.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          events.forEach((block) => {
            try {
              const event = parseOpenCodeSSEBlock(block);
              if (event) emitSSE(event);
            } catch {
              return;
            }
          });
        }
      } catch {
        if (controller.signal.aborted) return;
        if (eventStreamConnected) {
          eventStreamConnected = false;
          listeners.forEach((listener) =>
            listener({
              type: "runtime.disconnected",
              payload: { baseUrl },
            }),
          );
        }
      } finally {
        controller.signal.removeEventListener("abort", abortAttempt);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };
  void run();
};

const ensureServerInternal = async (): Promise<ServerRecord> => {
  const existing = server;
  if (existing && (await health(existing.baseUrl))) return existing;
  if (existing?.owned) existing.process?.kill();
  if (server === existing) server = undefined;

  const config = getCurrentAppConfig();
  const configuredBaseUrl = `http://127.0.0.1:${config.opencode.serverPort || 4096}`;
  if (await health(configuredBaseUrl)) {
    const connected = { baseUrl: configuredBaseUrl, owned: false };
    server = connected;
    startEventLoop(connected.baseUrl);
    return connected;
  }

  const port = await findAvailablePort(config.opencode.serverPort || 4096);
  const child = spawn(
    config.opencode.command || "opencode",
    [
      ...(config.opencode.args || []),
      "serve",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: undefined,
        OPENCODE_SERVER_USERNAME: undefined,
        OPENAI_BASE_URL: config.llm.baseUrl,
        OPENAI_API_KEY: config.llm.apiKey,
      },
    },
  );
  const candidate: ServerRecord = {
    baseUrl: `http://127.0.0.1:${port}`,
    process: child,
    owned: true,
  };
  let spawnError: Error | undefined;
  let exitDescription = "";
  let childOutput = "";
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    childOutput = `${childOutput}${chunk.toString("utf8")}`.slice(-2_000);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    childOutput = `${childOutput}${chunk.toString("utf8")}`.slice(-2_000);
  });
  child.once("exit", (code, signal) => {
    exitDescription = `process exited with code ${code ?? "null"}${
      signal ? ` (${signal})` : ""
    }`;
    if (server?.process === child) {
      server = undefined;
      eventAbort?.abort();
      eventAbort = undefined;
      eventLoopGeneration += 1;
    }
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (spawnError) break;
    if (await health(candidate.baseUrl)) {
      server = candidate;
      startEventLoop(candidate.baseUrl);
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  server = undefined;
  if (spawnError) throw spawnError;
  const detail = [exitDescription, lastHealthError, childOutput.trim()]
    .filter(Boolean)
    .join("; ");
  throw new Error(`OpenCode server failed to start${detail ? `: ${detail}` : ""}`);
};

const ensureServer = () => {
  if (ensureServerPromise) return ensureServerPromise;
  ensureServerPromise = ensureServerInternal().finally(() => {
    ensureServerPromise = undefined;
  });
  return ensureServerPromise;
};

const getMessages = async (
  baseUrl: string,
  workspacePath: string,
  runtimeSessionID: string,
) =>
  normalizeMessages(
    await requestOpenCodeJSON(
      baseUrl,
      `/session/${encodeURIComponent(runtimeSessionID)}/message${query(workspacePath, {
        limit: 500,
      })}`,
    ),
  );

const getModels = async (
  baseUrl: string,
  workspacePath: string,
): Promise<AgentModelOption[]> => {
  const value = unwrapData(
    await requestOpenCodeJSON(baseUrl, `/config/providers${query(workspacePath)}`),
  );
  if (!isRecord(value) || !Array.isArray(value.providers)) return [];
  const defaults = isRecord(value.default) ? value.default : {};

  return value.providers.flatMap((providerValue) => {
    if (!isRecord(providerValue) || typeof providerValue.id !== "string") return [];
    const providerID = providerValue.id;
    const providerName =
      typeof providerValue.name === "string" ? providerValue.name : providerID;
    const models = isRecord(providerValue.models) ? providerValue.models : {};
    return Object.entries(models).flatMap(([modelKey, modelValue]) => {
      if (!isRecord(modelValue)) return [];
      const modelID = typeof modelValue.id === "string" ? modelValue.id : modelKey;
      if (modelValue.status === "deprecated") return [];
      return [
        {
          providerID,
          providerName,
          modelID,
          modelName: typeof modelValue.name === "string" ? modelValue.name : modelID,
          isDefault: defaults[providerID] === modelID,
        },
      ];
    });
  });
};

const adapter: AgentRuntimeAdapter = {
  async ensureRuntime() {
    const current = await ensureServer();
    return { baseUrl: current.baseUrl };
  },
  async createSession(params) {
    const current = await ensureServer();
    const value = await requestOpenCodeJSON(
      current.baseUrl,
      `/session${query(params.workspacePath)}`,
      {
        method: "POST",
        body: JSON.stringify({ title: params.title }),
      },
    );
    const runtimeSessionID = extractSessionID(value);
    if (!runtimeSessionID) throw new Error("OpenCode did not return a session ID");
    return {
      runtimeSessionID,
      title: params.title,
      status: "idle",
      messages: [],
      interactions: [],
    };
  },
  async restoreSession(params) {
    const current = await ensureServer();
    try {
      await requestOpenCodeJSON(
        current.baseUrl,
        `/session/${encodeURIComponent(params.runtimeSessionID)}${query(
          params.workspacePath,
        )}`,
      );
    } catch {
      return undefined;
    }
    const [messages, status, interactions] = await Promise.all([
      getMessages(current.baseUrl, params.workspacePath, params.runtimeSessionID),
      sessionStatus(current.baseUrl, params.workspacePath, params.runtimeSessionID),
      pendingInteractions(
        current.baseUrl,
        params.workspacePath,
        params.runtimeSessionID,
      ),
    ]);
    return {
      runtimeSessionID: params.runtimeSessionID,
      status:
        interactions[0]?.type === "permission"
          ? "waiting_permission"
          : interactions[0]?.type === "question"
          ? "waiting_question"
          : status,
      messages,
      interactions,
    };
  },
  async listMessages(params) {
    const current = await ensureServer();
    return getMessages(current.baseUrl, params.workspacePath, params.runtimeSessionID);
  },
  async listModels(params) {
    const current = await ensureServer();
    return getModels(current.baseUrl, params.workspacePath);
  },
  async send(params) {
    const current = await ensureServer();
    await requestOpenCodeJSON(
      current.baseUrl,
      `/session/${encodeURIComponent(params.runtimeSessionID)}/prompt_async${query(
        params.workspacePath,
      )}`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(params.model ? { model: params.model } : {}),
          ...(params.system ? { system: params.system } : {}),
          parts: [{ type: "text", text: params.prompt }],
        }),
      },
    );
  },
  async abort(params) {
    const current = await ensureServer();
    await requestOpenCodeJSON(
      current.baseUrl,
      `/session/${encodeURIComponent(params.runtimeSessionID)}/abort${query(
        params.workspacePath,
      )}`,
      { method: "POST" },
    );
  },
  async replyPermission(params) {
    const current = await ensureServer();
    await requestOpenCodeJSON(
      current.baseUrl,
      `/permission/${encodeURIComponent(params.requestID)}/reply${query(
        params.workspacePath,
      )}`,
      {
        method: "POST",
        body: JSON.stringify({ reply: params.reply, message: params.message }),
      },
    );
  },
  async replyQuestion(params) {
    const current = await ensureServer();
    await requestOpenCodeJSON(
      current.baseUrl,
      `/question/${encodeURIComponent(params.requestID)}/${
        params.reject ? "reject" : "reply"
      }${query(params.workspacePath)}`,
      {
        method: "POST",
        body: params.reject
          ? undefined
          : JSON.stringify({ answers: params.answers ?? [] }),
      },
    );
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  stop() {
    eventAbort?.abort();
    eventAbort = undefined;
    eventLoopGeneration += 1;
    eventStreamConnected = false;
    eventStreamConnectedBefore = false;
    if (server?.owned) server.process?.kill();
    server = undefined;
  },
};

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

export const opencodeManager = {
  adapter,
  async ensureServer() {
    const current = await ensureServer();
    return { ok: true, baseUrl: current.baseUrl, alreadyRunning: true };
  },
  getBaseUrl() {
    return server?.baseUrl;
  },
  async probeServer(params: {
    workspaceID: string;
    port?: number;
    hostname?: string;
  }): Promise<RuntimeProbeReport> {
    const workspaceRoot = await getTerminalWorkspaceDir(params.workspaceID);
    try {
      const current = await ensureServer();
      const binding = createBinding(workspaceRoot, {
        serverBaseUrl: current.baseUrl,
        mode: "shared-server-session",
        status: "bound",
        reason: "OpenCode server is reachable and supports session APIs.",
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
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const binding = createBinding(workspaceRoot, {
        status: "failed",
        reason,
      });
      return {
        runtime: "opencode",
        serveCommandAvailable: false,
        configuredServerReachable: false,
        tuiAttachSupported: false,
        sessionListAvailable: false,
        sessionExportAvailable: false,
        sameSessionEvidence: reason,
        binding,
      };
    }
  },
  async startServer(_params?: {
    workspaceID?: string;
    port?: number;
    hostname?: string;
  }) {
    return this.ensureServer();
  },
  stopServer(_workspaceID?: string) {
    adapter.stop();
    return { ok: true, stopped: true };
  },
  async getBinding(workspaceID: string) {
    const existing = bindings.get(workspaceID);
    if (existing) return existing;
    const workspaceRoot = await getTerminalWorkspaceDir(workspaceID);
    return createBinding(workspaceRoot, {
      serverBaseUrl: server?.baseUrl,
      mode: server ? "shared-server-session" : "tui-only",
      status: server ? "bound" : "idle",
      reason: server
        ? "OpenCode server is available."
        : "OpenCode server is not running.",
    });
  },
  stopAll() {
    adapter.stop();
  },
};
