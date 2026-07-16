import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { Notification } from "electron";

import type {
  AgentHistoryQueryRequest,
  AgentHistoryQueryResponse,
  AgentInteraction,
  AgentMessage,
  AgentPermissionInteraction,
  AgentQuestionInteraction,
  AgentSession,
  AgentSessionEvent,
  AgentSessionStateSnapshot,
  AgentTurn,
  BotConversationPolicy,
  BotRequest,
  CreateAgentSessionParams,
  IMHistoryToolQuery,
  IMHistoryToolResult,
  SendAgentMessageParams,
  UpdateAgentSessionParams,
} from "../../src/types/agentSession";
import { IpcMainToRender } from "../constants";
import type { RuntimeSessionEvent } from "./agentRuntimeAdapter";
import { opencodeManager } from "./opencodeManage";
import { getStore } from "./storeManage";
import { getTerminalWorkspaceDir } from "./workspaceManage";
import { sendEvent, showWindow } from "./windowManage";
import {
  AgentHistoryCapabilityRegistry,
  normalizeHistoryToolQuery,
} from "./agentHistoryCapability";

const STORE_KEY = "agentSessions.v1";
const MAX_HISTORY_RESPONSE_BYTES = 1024 * 1024;
const MANAGED_FILE_VERSION = 1;

type PersistedSession = Omit<AgentSession, "messages">;

interface PersistedState {
  version: number;
  sessions: PersistedSession[];
  activeSessionByConversation: Record<string, string | undefined>;
  botPolicyByConversation: Record<string, BotConversationPolicy>;
  botContextLimitByConversation: Record<string, number | undefined>;
  botCheckpointByConversation: Record<string, string | undefined>;
  botRequests: BotRequest[];
  agentPanelOpen: boolean;
  terminalPanelOpen: boolean;
}

interface PendingHistoryRequest {
  resolve: (value: IMHistoryToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const store = getStore();
const adapter = opencodeManager.adapter;
const sessions = new Map<string, AgentSession>();
const autoApproveSessionIDs = new Set<string>();
const historyCapabilities = new AgentHistoryCapabilityRegistry();
const historyRequests = new Map<string, PendingHistoryRequest>();
const refreshTimers = new Map<string, NodeJS.Timeout>();
const fileWriteQueues = new Map<string, Promise<void>>();
let runtimeBaseUrl: string | undefined;
let initialized = false;
let initializePromise: Promise<AgentSessionStateSnapshot> | undefined;
let unsubscribeRuntime: (() => void) | undefined;
let historyServer: http.Server | undefined;
let historyBridgeUrl: string | undefined;
let viewport = {
  conversationID: undefined as string | undefined,
  sessionID: undefined as string | undefined,
  visible: false,
};

const createID = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const sortAgentSessions = (items: AgentSession[]) =>
  [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastOpenedAt - a.lastOpenedAt || b.updatedAt - a.updatedAt;
  });

const getNextQueuedTurn = (turns: AgentTurn[]) =>
  turns.find((turn) => turn.status === "queued");

const cancelUnfinishedTurns = (turns: AgentTurn[], at: number, reason: string) =>
  turns.map((turn) =>
    turn.status === "queued" || turn.status === "running"
      ? { ...turn, status: "cancelled" as const, updatedAt: at, lastError: reason }
      : turn,
  );

const defaultPersistedState = (): PersistedState => ({
  version: 1,
  sessions: [],
  activeSessionByConversation: {},
  botPolicyByConversation: {},
  botContextLimitByConversation: {},
  botCheckpointByConversation: {},
  botRequests: [],
  agentPanelOpen: true,
  terminalPanelOpen: false,
});

let state = defaultPersistedState();

const readPersistedState = () => {
  const value = store.get(STORE_KEY);
  if (!value || typeof value !== "object") return defaultPersistedState();
  const parsed = value as Partial<PersistedState>;
  return {
    version: 1,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    activeSessionByConversation:
      parsed.activeSessionByConversation &&
      typeof parsed.activeSessionByConversation === "object"
        ? parsed.activeSessionByConversation
        : {},
    botPolicyByConversation:
      parsed.botPolicyByConversation &&
      typeof parsed.botPolicyByConversation === "object"
        ? parsed.botPolicyByConversation
        : {},
    botContextLimitByConversation:
      parsed.botContextLimitByConversation &&
      typeof parsed.botContextLimitByConversation === "object"
        ? parsed.botContextLimitByConversation
        : {},
    botCheckpointByConversation:
      parsed.botCheckpointByConversation &&
      typeof parsed.botCheckpointByConversation === "object"
        ? parsed.botCheckpointByConversation
        : {},
    botRequests: Array.isArray(parsed.botRequests) ? parsed.botRequests : [],
    agentPanelOpen:
      typeof parsed.agentPanelOpen === "boolean" ? parsed.agentPanelOpen : true,
    terminalPanelOpen:
      typeof parsed.terminalPanelOpen === "boolean" ? parsed.terminalPanelOpen : false,
  };
};

const sessionCachePath = (session: AgentSession) =>
  path.join(session.workspacePath, ".openim-agent", "messages.json");

const sessionMetadataPath = (session: AgentSession) =>
  path.join(session.workspacePath, ".openim-agent", "session.json");

const persistedSessions = () =>
  [...sessions.values()].map(({ messages: _messages, ...session }) => session);

const persist = () => {
  state.sessions = persistedSessions();
  store.set(STORE_KEY, state);
};

const writeJSONAtomicInternal = async (filePath: string, value: unknown) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const suffix = `${process.pid}.${crypto.randomUUID()}`;
  const temporary = `${filePath}.${suffix}.tmp`;
  const backup = `${filePath}.${suffix}.bak`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  let movedExisting = false;
  try {
    try {
      await fs.promises.rename(filePath, backup);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.promises.rename(temporary, filePath);
    if (movedExisting) await fs.promises.rm(backup, { force: true });
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    if (movedExisting) {
      await fs.promises.rename(backup, filePath).catch(() => undefined);
    }
    throw error;
  }
};

const writeJSONAtomic = (filePath: string, value: unknown) => {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(() => writeJSONAtomicInternal(filePath, value));
  fileWriteQueues.set(filePath, queued);
  const cleanup = () => {
    if (fileWriteQueues.get(filePath) === queued) fileWriteQueues.delete(filePath);
  };
  void queued.then(cleanup, cleanup);
  return queued;
};

const persistSessionFiles = async (session: AgentSession) => {
  await Promise.all([
    writeJSONAtomic(sessionCachePath(session), session.messages),
    writeJSONAtomic(sessionMetadataPath(session), {
      version: MANAGED_FILE_VERSION,
      id: session.id,
      conversationID: session.conversationID,
      kind: session.kind,
      title: session.title,
      runtime: session.runtime,
      runtimeSessionID: session.runtimeSessionID,
      workspacePath: session.workspacePath,
      updatedAt: session.updatedAt,
    }),
  ]);
};

const readMessageCache = async (session: PersistedSession) => {
  try {
    const raw = await fs.promises.readFile(
      path.join(session.workspacePath, ".openim-agent", "messages.json"),
      "utf8",
    );
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as AgentMessage[]) : [];
  } catch {
    return [];
  }
};

const snapshot = (): AgentSessionStateSnapshot => ({
  sessions: sortAgentSessions([...sessions.values()]),
  activeSessionByConversation: { ...state.activeSessionByConversation },
  botPolicyByConversation: { ...state.botPolicyByConversation },
  botContextLimitByConversation: { ...state.botContextLimitByConversation },
  botCheckpointByConversation: { ...state.botCheckpointByConversation },
  botRequests: [...state.botRequests],
  agentPanelOpen: state.agentPanelOpen,
  terminalPanelOpen: state.terminalPanelOpen,
  runtimeBaseUrl,
  initialized,
});

const publish = () => {
  persist();
  sendEvent(IpcMainToRender.agentSessionEvent, {
    type: "snapshot",
    snapshot: snapshot(),
  } satisfies AgentSessionEvent);
};

const activeInViewport = (session: AgentSession) =>
  viewport.visible &&
  viewport.conversationID === session.conversationID &&
  viewport.sessionID === session.id;

const notifySession = (session: AgentSession, title: string, body: string) => {
  if (activeInViewport(session)) return;
  session.unreadCount += 1;
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on("click", () => {
    showWindow();
    sendEvent(IpcMainToRender.agentSessionEvent, {
      type: "navigate",
      conversationID: session.conversationID,
      sessionID: session.id,
    } satisfies AgentSessionEvent);
  });
  notification.show();
};

const safeWorkspacePath = async (
  params: CreateAgentSessionParams,
  sessionID: string,
) => {
  if (!params.workspacePath?.trim()) return getTerminalWorkspaceDir(sessionID);
  const workspacePath = path.resolve(params.workspacePath.trim());
  await fs.promises.mkdir(workspacePath, { recursive: true });
  return workspacePath;
};

const customHistoryTool = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Read recent or searched OpenIM messages from the IM conversation bound to this Agent session. This tool is read-only and cannot choose another conversation.",
  args: {
    mode: tool.schema.enum(["recent", "search"]),
    limit: tool.schema.number().int().min(1).max(100).optional(),
    beforeClientMsgID: tool.schema.string().optional(),
    keyword: tool.schema.string().max(128).optional(),
  },
  async execute(args, context) {
    const config = await Bun.file(context.directory + "/.openim-agent/bridge.json").json()
    if (!config.enabled || !config.url || !config.token) return "OpenIM history access is disabled for this session."
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.token,
      },
      body: JSON.stringify(args),
    })
    const text = await response.text()
    if (!response.ok) throw new Error("OpenIM history request failed: " + text)
    return text
  },
})
`;

const installSessionFiles = async (session: AgentSession) => {
  const toolPath = path.join(
    session.workspacePath,
    ".opencode",
    "tools",
    "openim_history.ts",
  );
  await fs.promises.mkdir(path.dirname(toolPath), { recursive: true });
  try {
    const existing = await fs.promises.readFile(toolPath, "utf8");
    if (existing !== customHistoryTool && !existing.includes("OpenIM history access")) {
      session.liveHistoryEnabled = false;
      session.lastError =
        "Existing .opencode/tools/openim_history.ts was not overwritten.";
      return;
    }
  } catch {
    // The generated tool does not exist yet.
  }
  await fs.promises.writeFile(toolPath, customHistoryTool, "utf8");
  await refreshHistoryCapability(session);
};

const refreshHistoryCapability = async (session: AgentSession) => {
  historyCapabilities.revokeSession(session.id);
  const token = session.liveHistoryEnabled
    ? historyCapabilities.issue(session.id, session.conversationID).token
    : "";
  await writeJSONAtomic(
    path.join(session.workspacePath, ".openim-agent", "bridge.json"),
    {
      version: 1,
      enabled: Boolean(token && historyBridgeUrl),
      url: historyBridgeUrl ? `${historyBridgeUrl}/v1/history` : undefined,
      token: token || undefined,
    },
  );
};

const auditHistoryQuery = async (
  session: AgentSession,
  query: IMHistoryToolQuery,
  count: number,
) => {
  const auditPath = path.join(session.workspacePath, ".openim-agent", "audit.ndjson");
  await fs.promises.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.promises.appendFile(
    auditPath,
    `${JSON.stringify({
      type: "im_history",
      at: Date.now(),
      sessionID: session.id,
      mode: query.mode,
      limit: query.limit,
      beforeClientMsgID: query.beforeClientMsgID,
      hasKeyword: Boolean(query.keyword),
      count,
    })}\n`,
    "utf8",
  );
};

const requestRendererHistory = (
  session: AgentSession,
  queryValue: IMHistoryToolQuery,
) =>
  new Promise<IMHistoryToolResult>((resolve, reject) => {
    const requestID = createID("history_request");
    const timer = setTimeout(() => {
      historyRequests.delete(requestID);
      reject(new Error("OpenIM history request timed out"));
    }, 10_000);
    historyRequests.set(requestID, { resolve, reject, timer });
    const request: AgentHistoryQueryRequest = {
      requestID,
      sessionID: session.id,
      conversationID: session.conversationID,
      query: queryValue,
    };
    sendEvent(IpcMainToRender.agentSessionEvent, {
      type: "history-query",
      request,
    } satisfies AgentSessionEvent);
  });

const startHistoryServer = () =>
  new Promise<void>((resolve, reject) => {
    if (historyServer) {
      resolve();
      return;
    }
    historyServer = http.createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/history") {
        response.writeHead(404).end("Not found");
        return;
      }
      const authorization = request.headers.authorization ?? "";
      const token = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      const capability = historyCapabilities.resolve(token);
      const session = capability ? sessions.get(capability.sessionID) : undefined;
      if (
        !session ||
        !session.liveHistoryEnabled ||
        session.conversationID !== capability?.conversationID
      ) {
        response.writeHead(401).end("History capability is invalid or disabled");
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 16 * 1024) chunks.push(chunk);
        else request.destroy(new Error("History query is too large"));
      });
      request.on("error", () => {
        if (!response.headersSent) response.writeHead(400).end("Invalid request");
      });
      request.on("end", async () => {
        try {
          const parsed = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as Partial<IMHistoryToolQuery>;
          const queryValue = normalizeHistoryToolQuery(parsed);
          const result = await requestRendererHistory(session, queryValue);
          const body = JSON.stringify(result);
          if (Buffer.byteLength(body) > MAX_HISTORY_RESPONSE_BYTES) {
            throw new Error("History response exceeds 1 MB");
          }
          await auditHistoryQuery(session, queryValue, result.messages.length);
          response
            .writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
            .end(body);
        } catch (error) {
          response
            .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
            .end(error instanceof Error ? error.message : String(error));
        }
      });
    });
    historyServer.once("error", reject);
    historyServer.listen(0, "127.0.0.1", () => {
      const address = historyServer?.address();
      if (!address || typeof address === "string") {
        reject(new Error("History bridge did not bind to TCP"));
        return;
      }
      historyBridgeUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

const mergeRuntimeMessages = (
  session: AgentSession,
  runtimeMessages: AgentMessage[],
) => {
  const runtimeIDs = new Set(runtimeMessages.map((message) => message.id));
  const localMessages = session.messages.filter(
    (message) => message.id.startsWith("local_") && !runtimeIDs.has(message.id),
  );
  return [...runtimeMessages, ...localMessages].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
};

const refreshMessages = async (session: AgentSession) => {
  if (!session.runtimeSessionID) return;
  try {
    const messages = await adapter.listMessages({
      workspacePath: session.workspacePath,
      runtimeSessionID: session.runtimeSessionID,
    });
    session.messages = mergeRuntimeMessages(session, messages);
    session.updatedAt = Date.now();
    await persistSessionFiles(session);
    publish();
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : String(error);
  }
};

const scheduleRefresh = (session: AgentSession, delay = 120) => {
  const current = refreshTimers.get(session.id);
  if (current) clearTimeout(current);
  refreshTimers.set(
    session.id,
    setTimeout(() => {
      refreshTimers.delete(session.id);
      void refreshMessages(session);
    }, delay),
  );
};

const updateBotRequestForTurn = (
  turn: AgentTurn,
  status: BotRequest["status"],
  lastError?: string,
) => {
  if (!turn.triggerMessageID) return;
  state.botRequests = state.botRequests.map((request) =>
    request.triggerMessageID === turn.triggerMessageID
      ? { ...request, status, lastError, updatedAt: Date.now() }
      : request,
  );
};

const dispatchNext = async (session: AgentSession) => {
  if (
    session.status !== "idle" ||
    !session.runtimeSessionID ||
    session.interactions.length > 0
  ) {
    return;
  }
  const turn = getNextQueuedTurn(session.turns);
  if (!turn) return;
  turn.status = "running";
  turn.updatedAt = Date.now();
  session.status = "running";
  session.updatedAt = Date.now();
  if (turn.source === "bot") updateBotRequestForTurn(turn, "running");
  publish();
  try {
    await adapter.send({
      workspacePath: session.workspacePath,
      runtimeSessionID: session.runtimeSessionID,
      prompt: turn.prompt,
      messageID: `local_${turn.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    turn.status = "failed";
    turn.lastError = message;
    turn.updatedAt = Date.now();
    session.status = "error";
    session.lastError = message;
    session.updatedAt = Date.now();
    if (turn.source === "bot") updateBotRequestForTurn(turn, "failed", message);
    notifySession(session, "Agent session failed", session.title);
    publish();
  }
};

const completeActiveTurn = (session: AgentSession) => {
  const turn = session.turns.find((item) => item.status === "running");
  if (!turn) return;
  turn.status = "completed";
  turn.updatedAt = Date.now();
  if (turn.source === "bot") updateBotRequestForTurn(turn, "completed");
};

const interactionFromEvent = (
  event: RuntimeSessionEvent,
): AgentInteraction | undefined => {
  const requestID =
    typeof event.payload.id === "string"
      ? event.payload.id
      : typeof event.payload.requestID === "string"
      ? event.payload.requestID
      : undefined;
  if (!event.runtimeSessionID || !requestID) return undefined;
  if (event.type === "permission.asked") {
    return {
      id: requestID,
      type: "permission",
      sessionID: event.runtimeSessionID,
      permission: String(event.payload.permission ?? "permission"),
      patterns: Array.isArray(event.payload.patterns)
        ? event.payload.patterns.map(String)
        : [],
      always: Array.isArray(event.payload.always)
        ? event.payload.always.map(String)
        : [],
      metadata:
        event.payload.metadata && typeof event.payload.metadata === "object"
          ? (event.payload.metadata as Record<string, unknown>)
          : undefined,
      createdAt: Date.now(),
    } satisfies AgentPermissionInteraction;
  }
  if (event.type === "question.asked") {
    const questions = Array.isArray(event.payload.questions)
      ? event.payload.questions
      : [];
    return {
      id: requestID,
      type: "question",
      sessionID: event.runtimeSessionID,
      questions: questions
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => ({
          header: typeof item.header === "string" ? item.header : undefined,
          question: String(item.question ?? "Agent question"),
          options: Array.isArray(item.options)
            ? item.options
                .filter(
                  (option): option is Record<string, unknown> =>
                    Boolean(option) &&
                    typeof option === "object" &&
                    !Array.isArray(option),
                )
                .map((option) => ({
                  label: String(option.label ?? "Option"),
                  description:
                    typeof option.description === "string"
                      ? option.description
                      : undefined,
                }))
            : [],
          multiple: Boolean(item.multiple),
          custom: Boolean(item.custom),
        })),
      createdAt: Date.now(),
    } satisfies AgentQuestionInteraction;
  }
  return undefined;
};

const handleRuntimeEvent = (event: RuntimeSessionEvent) => {
  if (event.type === "runtime.disconnected") {
    sessions.forEach((session) => {
      if (!session.archived) session.status = "disconnected";
    });
    publish();
    return;
  }
  if (event.type === "runtime.connected") {
    void reconcileRuntimeSessions().then(publish);
    return;
  }
  const session = [...sessions.values()].find(
    (item) => item.runtimeSessionID === event.runtimeSessionID,
  );
  if (!session) return;

  if (event.type === "message.updated" || event.type === "message.part.updated") {
    scheduleRefresh(session);
    return;
  }
  if (event.type === "session.status") {
    const status = event.payload.status;
    const statusRecord =
      status && typeof status === "object"
        ? (status as Record<string, unknown>)
        : undefined;
    const type = statusRecord?.type ?? status;
    if (type === "busy") {
      session.status = "running";
      session.lastError = undefined;
    }
    if (type === "retry") {
      session.status = "running";
      session.lastError = String(
        statusRecord?.message ?? "OpenCode is retrying the model request.",
      );
      scheduleRefresh(session, 0);
    }
    publish();
    return;
  }
  if (event.type === "session.idle") {
    completeActiveTurn(session);
    session.status = "idle";
    session.lastCompletedAt = Date.now();
    session.updatedAt = Date.now();
    scheduleRefresh(session, 0);
    notifySession(session, "Agent response ready", session.title);
    publish();
    void dispatchNext(session);
    return;
  }
  if (event.type === "session.error") {
    const error = event.payload.error;
    session.status = "error";
    session.lastError =
      typeof error === "string" ? error : JSON.stringify(error ?? "Agent error");
    session.updatedAt = Date.now();
    const turn = session.turns.find((item) => item.status === "running");
    if (turn) {
      turn.status = "failed";
      turn.lastError = session.lastError;
      turn.updatedAt = Date.now();
      if (turn.source === "bot") {
        updateBotRequestForTurn(turn, "failed", session.lastError);
      }
    }
    notifySession(session, "Agent session error", session.title);
    publish();
    return;
  }
  const interaction = interactionFromEvent(event);
  if (interaction) {
    if (interaction.type === "permission" && autoApproveSessionIDs.has(session.id)) {
      void adapter
        .replyPermission({
          workspacePath: session.workspacePath,
          requestID: interaction.id,
          reply: "once",
        })
        .catch((error) => {
          session.interactions = [
            ...session.interactions.filter((item) => item.id !== interaction.id),
            interaction,
          ];
          session.status = "waiting_permission";
          session.lastError = error instanceof Error ? error.message : String(error);
          publish();
        });
      return;
    }
    session.interactions = [
      ...session.interactions.filter((item) => item.id !== interaction.id),
      interaction,
    ];
    session.status =
      interaction.type === "permission" ? "waiting_permission" : "waiting_question";
    session.updatedAt = Date.now();
    notifySession(
      session,
      interaction.type === "permission"
        ? "Agent needs permission"
        : "Agent has a question",
      session.title,
    );
    publish();
    return;
  }
  if (
    event.type === "permission.replied" ||
    event.type === "question.replied" ||
    event.type === "question.rejected"
  ) {
    const requestID = event.payload.requestID ?? event.payload.id;
    session.interactions = session.interactions.filter((item) => item.id !== requestID);
    session.status = session.interactions.length > 0 ? session.status : "running";
    publish();
  }
};

const restorePersistedSessions = async () => {
  state = readPersistedState();
  const restoredAt = Date.now();
  state.botRequests = state.botRequests.map((request) =>
    request.status === "queued" || request.status === "running"
      ? {
          ...request,
          status: "failed",
          lastError: "Application stopped before this request completed.",
          updatedAt: restoredAt,
        }
      : request,
  );
  const restored = await Promise.all(
    state.sessions.map(async (saved) => {
      const turns = cancelUnfinishedTurns(
        saved.turns,
        restoredAt,
        "Application stopped before this request completed.",
      );
      return {
        ...saved,
        turns,
        status:
          saved.archived || saved.status === "archived" ? "archived" : "disconnected",
        messages: await readMessageCache(saved),
        interactions: [],
      } satisfies AgentSession;
    }),
  );
  restored.forEach((session) => sessions.set(session.id, session));
};

const reconcileRuntimeSessions = async () => {
  const runtime = await adapter.ensureRuntime();
  runtimeBaseUrl = runtime.baseUrl;
  await Promise.all(
    [...sessions.values()]
      .filter((session) => !session.archived)
      .map(async (session) => {
        await installSessionFiles(session);
        if (!session.runtimeSessionID) {
          session.status = "recovery_required";
          return;
        }
        try {
          const restored = await adapter.restoreSession({
            workspacePath: session.workspacePath,
            runtimeSessionID: session.runtimeSessionID,
          });
          if (!restored) {
            session.status = "recovery_required";
            session.lastError = "The OpenCode session no longer exists.";
            return;
          }
          session.status = restored.status;
          session.messages = mergeRuntimeMessages(session, restored.messages);
          session.interactions = restored.interactions;
          session.lastError = undefined;
          await persistSessionFiles(session);
        } catch (error) {
          session.status = "disconnected";
          session.lastError = error instanceof Error ? error.message : String(error);
        }
      }),
  );
};

const ensureInitialized = async () => {
  if (initialized) return snapshot();
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    await restorePersistedSessions();
    await startHistoryServer();
    unsubscribeRuntime = adapter.subscribe(handleRuntimeEvent);
    try {
      await reconcileRuntimeSessions();
    } catch (error) {
      [...sessions.values()].forEach((session) => {
        if (!session.archived) {
          session.status = "disconnected";
          session.lastError = error instanceof Error ? error.message : String(error);
        }
      });
    }
    initialized = true;
    publish();
    return snapshot();
  })();
  return initializePromise;
};

const createSession = async (params: CreateAgentSessionParams) => {
  await ensureInitialized();
  const id = createID("agent_session");
  const workspacePath = await safeWorkspacePath(params, id);
  const now = Date.now();
  const session: AgentSession = {
    id,
    conversationID: params.conversationID,
    kind: params.kind ?? "manual",
    title:
      params.title?.trim() ||
      (params.kind === "bot" ? "Bot 请求" : `Agent 会话 ${sessions.size + 1}`),
    runtime: "opencode",
    workspacePath,
    managedWorkspace: !params.workspacePath?.trim(),
    status: "creating",
    pinned: params.kind === "bot",
    archived: false,
    unreadCount: 0,
    liveHistoryEnabled:
      typeof params.liveHistoryEnabled === "boolean"
        ? params.liveHistoryEnabled
        : params.kind !== "bot",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    messages: [],
    turns: [],
    interactions: [],
  };
  if (!params.title?.trim()) {
    session.title =
      params.kind === "bot" ? "Bot Requests" : `Agent Session ${sessions.size + 1}`;
  }
  sessions.set(id, session);
  state.activeSessionByConversation[params.conversationID] = id;
  publish();
  try {
    await installSessionFiles(session);
    const runtimeSession = await adapter.createSession({
      workspacePath,
      title: session.title,
    });
    session.runtimeSessionID = runtimeSession.runtimeSessionID;
    session.status = runtimeSession.status;
    session.messages = runtimeSession.messages;
    session.interactions = runtimeSession.interactions;
    session.updatedAt = Date.now();
    await persistSessionFiles(session);
    publish();
    if (params.initialPrompt?.trim()) {
      await queueMessage({ sessionID: id, text: params.initialPrompt.trim() });
    }
    return session;
  } catch (error) {
    session.status = "error";
    session.lastError = error instanceof Error ? error.message : String(error);
    session.updatedAt = Date.now();
    publish();
    throw error;
  }
};

const queueMessage = async (params: SendAgentMessageParams) => {
  await ensureInitialized();
  const session = sessions.get(params.sessionID);
  if (!session || session.archived) throw new Error("Agent session not found");
  if (session.status === "disconnected" || session.status === "recovery_required") {
    throw new Error("Recover the Agent runtime session before sending a message");
  }
  if (session.status === "error") {
    session.status = "idle";
    session.lastError = undefined;
  }
  const text = params.text.trim();
  if (!text) throw new Error("Agent message is empty");
  const now = Date.now();
  const turn: AgentTurn = {
    id: createID("agent_turn"),
    sessionID: session.id,
    source: params.source ?? "manual",
    prompt: text,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    triggerMessageID: params.triggerMessageID,
    contextPaths: params.contextPaths,
  };
  session.turns.push(turn);
  session.messages.push({
    id: `local_${turn.id}`,
    sessionID: session.runtimeSessionID ?? session.id,
    role: "user",
    createdAt: now,
    parts: [{ id: `local_${turn.id}_text`, type: "text", text }],
  });
  session.updatedAt = now;
  publish();
  await persistSessionFiles(session);
  await dispatchNext(session);
  return turn;
};

const getOrCreateBotSession = async (conversationID: string) => {
  const existing = [...sessions.values()].find(
    (session) =>
      session.conversationID === conversationID &&
      session.kind === "bot" &&
      !session.archived,
  );
  if (existing) return existing;
  return createSession({
    conversationID,
    kind: "bot",
    title: "Bot 请求",
    liveHistoryEnabled: false,
  });
};

export const agentSessionManager = {
  initialize: ensureInitialized,
  getSnapshot: async () => {
    await ensureInitialized();
    return snapshot();
  },
  createSession,
  async updateSession(params: UpdateAgentSessionParams) {
    await ensureInitialized();
    const session = sessions.get(params.sessionID);
    if (!session) throw new Error("Agent session not found");
    if (typeof params.title === "string" && params.title.trim()) {
      session.title = params.title.trim();
    }
    if (typeof params.pinned === "boolean") session.pinned = params.pinned;
    if (
      typeof params.liveHistoryEnabled === "boolean" &&
      params.liveHistoryEnabled !== session.liveHistoryEnabled
    ) {
      session.liveHistoryEnabled = params.liveHistoryEnabled;
      await refreshHistoryCapability(session);
    }
    session.updatedAt = Date.now();
    await persistSessionFiles(session);
    publish();
    return session;
  },
  async archiveSession(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) return undefined;
    session.archived = true;
    session.status = "archived";
    session.updatedAt = Date.now();
    autoApproveSessionIDs.delete(sessionID);
    await refreshHistoryCapability(session);
    if (state.activeSessionByConversation[session.conversationID] === sessionID) {
      state.activeSessionByConversation[session.conversationID] = [...sessions.values()]
        .filter(
          (item) => item.conversationID === session.conversationID && !item.archived,
        )
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id;
    }
    publish();
    return session;
  },
  async selectSession(conversationID: string, sessionID?: string) {
    await ensureInitialized();
    const session = sessionID ? sessions.get(sessionID) : undefined;
    if (session && session.conversationID !== conversationID) {
      throw new Error("Agent session belongs to another conversation");
    }
    state.activeSessionByConversation[conversationID] = sessionID;
    if (session) {
      session.lastOpenedAt = Date.now();
      session.unreadCount = 0;
    }
    publish();
    return snapshot();
  },
  sendMessage: queueMessage,
  async abort(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session?.runtimeSessionID) return;
    await adapter.abort({
      workspacePath: session.workspacePath,
      runtimeSessionID: session.runtimeSessionID,
    });
    const turn = session.turns.find((item) => item.status === "running");
    if (turn) {
      turn.status = "cancelled";
      turn.updatedAt = Date.now();
    }
    session.status = "idle";
    session.updatedAt = Date.now();
    publish();
    await dispatchNext(session);
  },
  async recover(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) throw new Error("Agent session not found");
    const runtimeSession = await adapter.createSession({
      workspacePath: session.workspacePath,
      title: session.title,
    });
    session.runtimeSessionID = runtimeSession.runtimeSessionID;
    session.status = "idle";
    session.lastError = undefined;
    session.interactions = [];
    session.messages.push({
      id: createID("local_system"),
      sessionID: session.id,
      role: "system",
      createdAt: Date.now(),
      parts: [
        {
          id: createID("local_system_part"),
          type: "text",
          text: "A replacement OpenCode session was created in the existing workspace.",
        },
      ],
    });
    await persistSessionFiles(session);
    publish();
    await dispatchNext(session);
    return session;
  },
  async replyPermission(
    sessionID: string,
    requestID: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) throw new Error("Agent session not found");
    await adapter.replyPermission({
      workspacePath: session.workspacePath,
      requestID,
      reply,
      message,
    });
    session.interactions = session.interactions.filter((item) => item.id !== requestID);
    session.status = session.interactions.length > 0 ? session.status : "running";
    publish();
  },
  async replyQuestion(
    sessionID: string,
    requestID: string,
    answers?: string[][],
    reject?: boolean,
  ) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) throw new Error("Agent session not found");
    await adapter.replyQuestion({
      workspacePath: session.workspacePath,
      requestID,
      answers,
      reject,
    });
    session.interactions = session.interactions.filter((item) => item.id !== requestID);
    session.status = session.interactions.length > 0 ? session.status : "running";
    publish();
  },
  async setAutoApprove(sessionID: string, enabled: boolean) {
    await ensureInitialized();
    if (enabled) autoApproveSessionIDs.add(sessionID);
    else autoApproveSessionIDs.delete(sessionID);
    return { sessionID, enabled };
  },
  isAutoApproveEnabled(sessionID: string) {
    return autoApproveSessionIDs.has(sessionID);
  },
  async markRead(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) return;
    session.unreadCount = 0;
    publish();
  },
  async setViewport(next: typeof viewport) {
    viewport = next;
    if (next.visible && next.sessionID) {
      const session = sessions.get(next.sessionID);
      if (session) session.unreadCount = 0;
    }
    publish();
  },
  async setPanelState(patch: {
    agentPanelOpen?: boolean;
    terminalPanelOpen?: boolean;
  }) {
    await ensureInitialized();
    if (typeof patch.agentPanelOpen === "boolean") {
      state.agentPanelOpen = patch.agentPanelOpen;
    }
    if (typeof patch.terminalPanelOpen === "boolean") {
      state.terminalPanelOpen = patch.terminalPanelOpen;
    }
    publish();
  },
  async setBotPolicy(
    conversationID: string,
    policy: BotConversationPolicy,
    contextLimit?: number,
  ) {
    await ensureInitialized();
    state.botPolicyByConversation[conversationID] = policy;
    if (contextLimit !== undefined) {
      state.botContextLimitByConversation[conversationID] = Math.min(
        Math.max(contextLimit, 1),
        200,
      );
    }
    publish();
  },
  async setBotCheckpoint(conversationID: string, clientMsgID?: string) {
    await ensureInitialized();
    if (clientMsgID) state.botCheckpointByConversation[conversationID] = clientMsgID;
    else delete state.botCheckpointByConversation[conversationID];
    persist();
    return state.botCheckpointByConversation[conversationID];
  },
  async addBotRequest(request: BotRequest) {
    await ensureInitialized();
    if (
      state.botRequests.some(
        (item) => item.triggerMessageID === request.triggerMessageID,
      )
    ) {
      return { added: false, snapshot: snapshot() };
    }
    state.botRequests = [request, ...state.botRequests].slice(0, 500);
    publish();
    if (
      state.botPolicyByConversation[request.conversationID] !== "off" &&
      viewport.conversationID !== request.conversationID &&
      Notification.isSupported()
    ) {
      const notification = new Notification({
        title: "Bot request needs review",
        body: request.instructionText || request.triggerText,
      });
      notification.on("click", () => {
        showWindow();
        sendEvent(IpcMainToRender.agentSessionEvent, {
          type: "navigate",
          conversationID: request.conversationID,
        } satisfies AgentSessionEvent);
      });
      notification.show();
    }
    return { added: true, snapshot: snapshot() };
  },
  async ensureBotSession(conversationID: string) {
    await ensureInitialized();
    return getOrCreateBotSession(conversationID);
  },
  async ignoreBotRequest(requestID: string) {
    await ensureInitialized();
    state.botRequests = state.botRequests.map((request) =>
      request.id === requestID
        ? { ...request, status: "ignored", updatedAt: Date.now() }
        : request,
    );
    publish();
  },
  async runBotRequest(params: {
    requestID: string;
    prompt: string;
    contextPaths?: string[];
  }) {
    await ensureInitialized();
    const request = state.botRequests.find((item) => item.id === params.requestID);
    if (!request) throw new Error("Bot request not found");
    const session = await getOrCreateBotSession(request.conversationID);
    request.agentSessionID = session.id;
    request.contextPaths = params.contextPaths;
    request.status = "queued";
    request.updatedAt = Date.now();
    publish();
    return queueMessage({
      sessionID: session.id,
      text: params.prompt,
      source: "bot",
      triggerMessageID: request.triggerMessageID,
      contextPaths: params.contextPaths,
    });
  },
  async writeSessionFiles(
    sessionID: string,
    files: Array<{ relativePath: string; content: string }>,
  ) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) throw new Error("Agent session not found");
    const root = path.resolve(session.workspacePath);
    const written: string[] = [];
    for (const file of files) {
      const target = path.resolve(root, file.relativePath);
      if (!target.startsWith(`${root}${path.sep}`)) {
        throw new Error("Unsafe Agent session relative path");
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, file.content, "utf8");
      written.push(file.relativePath.replaceAll("\\", "/"));
    }
    return written;
  },
  async getTerminalLaunch(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session || session.archived) throw new Error("Agent session not found");
    if (!session.runtimeSessionID) {
      throw new Error("Agent runtime session is not available");
    }
    if (!runtimeBaseUrl) runtimeBaseUrl = (await adapter.ensureRuntime()).baseUrl;
    return {
      tabID: `agent-terminal-${session.id}`,
      sessionID: session.id,
      cwd: session.workspacePath,
      baseUrl: runtimeBaseUrl,
      runtimeSessionID: session.runtimeSessionID,
    };
  },
  handleHistoryResponse(response: AgentHistoryQueryResponse) {
    const pending = historyRequests.get(response.requestID);
    if (!pending) return;
    historyRequests.delete(response.requestID);
    clearTimeout(pending.timer);
    if (response.error || !response.result) {
      pending.reject(new Error(response.error || "History query returned no result"));
      return;
    }
    pending.resolve(response.result);
  },
  async stop() {
    const shutdownAt = Date.now();
    await Promise.allSettled(
      [...sessions.values()]
        .filter(
          (session) =>
            session.runtimeSessionID &&
            (session.status === "running" ||
              session.status === "waiting_permission" ||
              session.status === "waiting_question"),
        )
        .map((session) =>
          adapter.abort({
            workspacePath: session.workspacePath,
            runtimeSessionID: session.runtimeSessionID!,
          }),
        ),
    );
    await Promise.all(
      [...sessions.values()].map(async (session) => {
        session.turns.forEach((turn) => {
          if (turn.status === "running" || turn.status === "queued") {
            turn.status = "cancelled";
            turn.updatedAt = shutdownAt;
            turn.lastError = "Application exited before this request completed.";
          }
        });
        if (!session.archived && session.status !== "recovery_required") {
          session.status = "disconnected";
        }
        session.updatedAt = shutdownAt;
        await persistSessionFiles(session);
      }),
    );
    persist();
    initialized = false;
    initializePromise = undefined;
    unsubscribeRuntime?.();
    unsubscribeRuntime = undefined;
    refreshTimers.forEach(clearTimeout);
    refreshTimers.clear();
    historyRequests.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error("Application is shutting down"));
    });
    historyRequests.clear();
    historyCapabilities.clear();
    await new Promise<void>((resolve) => {
      if (!historyServer) {
        resolve();
        return;
      }
      historyServer.close(() => resolve());
    });
    historyServer = undefined;
    historyBridgeUrl = undefined;
    sessions.clear();
    autoApproveSessionIDs.clear();
  },
};
