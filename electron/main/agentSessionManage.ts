import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { app, Notification } from "electron";

import type {
  AgentDeliveryResponse,
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
import { AGENT_DELIVERY_SYSTEM_PROMPT, resolveAgentDelivery } from "./agentDelivery";
import {
  AgentHistoryCapabilityRegistry,
  normalizeHistoryToolQuery,
} from "./agentHistoryCapability";
import { mergeAgentRuntimeMessages } from "./agentMessageMerge";
import type { RuntimeSessionEvent } from "./agentRuntimeAdapter";
import { agentRuntimeRegistry, DEFAULT_AGENT_RUNTIME_ID } from "./agentRuntimeRegistry";
import {
  discoverExternalAgentSessions,
  discoverManagedAgentSessions,
} from "./agentSessionRecovery";
import { applyRuntimeMessageEvent } from "./agentStreaming";
import { getStore } from "./storeManage";
import { sendEvent, showWindow } from "./windowManage";
import { getTerminalWorkspaceDir, getWorkspaceRoot } from "./workspaceManage";

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
const adapter = agentRuntimeRegistry.require(DEFAULT_AGENT_RUNTIME_ID);
const sessions = new Map<string, AgentSession>();
const autoApproveSessionIDs = new Set<string>();
const historyCapabilities = new AgentHistoryCapabilityRegistry();
const historyRequests = new Map<string, PendingHistoryRequest>();
const refreshTimers = new Map<string, NodeJS.Timeout>();
const streamPublishTimers = new Map<string, NodeJS.Timeout>();
const pendingDeliveryRequests = new Map<string, string>();
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
      archived: session.archived,
      pinned: session.pinned,
      liveHistoryEnabled: session.liveHistoryEnabled,
      parentSessionID: session.parentSessionID,
      collaborationID: session.collaborationID,
      gatewayRunID: session.gatewayRunID,
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

const broadcastSnapshot = () => {
  sendEvent(IpcMainToRender.agentSessionEvent, {
    type: "snapshot",
    snapshot: snapshot(),
  } satisfies AgentSessionEvent);
};

const publish = () => {
  persist();
  broadcastSnapshot();
};

const scheduleStreamPublish = (sessionID: string) => {
  if (streamPublishTimers.has(sessionID)) return;
  streamPublishTimers.set(
    sessionID,
    setTimeout(() => {
      streamPublishTimers.delete(sessionID);
      broadcastSnapshot();
    }, 32),
  );
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
    historyServer = http.createServer((request, response) => {
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

const refreshMessages = async (session: AgentSession) => {
  if (!session.runtimeSessionID) return;
  try {
    const messages = await adapter.listMessages({
      workspacePath: session.workspacePath,
      runtimeSessionID: session.runtimeSessionID,
    });
    session.messages = mergeAgentRuntimeMessages(session.messages, messages);
    session.updatedAt = Date.now();
    await persistSessionFiles(session);
    publish();
    await maybeRequestAutoDelivery(session);
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : String(error);
  }
};

const latestCompletedAssistantTurn = (session: AgentSession) => {
  let lastUserIndex = -1;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return session.messages
    .slice(lastUserIndex + 1)
    .filter(
      (item) =>
        item.role === "assistant" &&
        typeof item.completedAt === "number" &&
        item.parts.some(
          (part) =>
            part.type === "text" || part.type === "file" || part.type === "tool",
        ),
    );
};

const maybeRequestAutoDelivery = async (session: AgentSession) => {
  if (
    session.status !== "idle" ||
    !session.lastCompletedAt ||
    (!session.autoReplyTextEnabled && !session.autoFileAttachmentEnabled)
  ) {
    return;
  }
  const turnMessages = latestCompletedAssistantTurn(session);
  const message = turnMessages[turnMessages.length - 1];
  if (!message) return;
  const messageAt = message.completedAt ?? message.createdAt;
  const wantsText =
    session.autoReplyTextEnabled &&
    messageAt >= (session.autoReplyTextEnabledAt ?? Number.MAX_SAFE_INTEGER) &&
    session.lastAutoReplyMessageID !== message.id;
  const wantsAttachments =
    session.autoFileAttachmentEnabled &&
    messageAt >= (session.autoFileAttachmentEnabledAt ?? Number.MAX_SAFE_INTEGER) &&
    session.lastAutoAttachmentMessageID !== message.id;
  if (!wantsText && !wantsAttachments) return;
  if (pendingDeliveryRequests.has(session.id)) return;

  const resolved = await resolveAgentDelivery(session.workspacePath, turnMessages);
  if (wantsText && !resolved.text) {
    session.lastAutoReplyMessageID = message.id;
  }
  if (wantsAttachments && resolved.attachments.length === 0) {
    session.lastAutoAttachmentMessageID = message.id;
  }
  const deliveryText = wantsText ? resolved.text || undefined : undefined;
  const deliveryAttachments = wantsAttachments ? resolved.attachments : [];
  if (!deliveryText && deliveryAttachments.length === 0) {
    persist();
    return;
  }
  const requestID = createID("agent_delivery");
  pendingDeliveryRequests.set(session.id, requestID);
  setTimeout(() => {
    if (pendingDeliveryRequests.get(session.id) === requestID) {
      pendingDeliveryRequests.delete(session.id);
    }
  }, 30_000).unref();
  sendEvent(IpcMainToRender.agentSessionEvent, {
    type: "delivery-request",
    request: {
      requestID,
      sessionID: session.id,
      conversationID: session.conversationID,
      messageID: message.id,
      text: deliveryText,
      attachments: deliveryAttachments,
    },
  } satisfies AgentSessionEvent);
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
      model: session.model,
      system: session.autoFileAttachmentEnabled
        ? AGENT_DELIVERY_SYSTEM_PROMPT
        : undefined,
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
    session.messages = applyRuntimeMessageEvent(session.messages, event);
    session.updatedAt = Date.now();
    const streamedMessage = event.messageID
      ? session.messages.find((message) => message.id === event.messageID)
      : event.message;
    if (
      event.part?.type === "text" &&
      streamedMessage?.role === "assistant" &&
      Boolean(event.part.text || event.delta)
    ) {
      broadcastSnapshot();
    } else {
      scheduleStreamPublish(session.id);
    }
    scheduleRefresh(session, 250);
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
        autoReplyTextEnabled: saved.autoReplyTextEnabled === true,
        autoFileAttachmentEnabled: saved.autoFileAttachmentEnabled === true,
        turns,
        status:
          saved.archived || saved.status === "archived" ? "archived" : "disconnected",
        messages: await readMessageCache(saved),
        interactions: [],
      } satisfies AgentSession;
    }),
  );
  restored.forEach((session) => sessions.set(session.id, session));
  const discovered = await discoverManagedAgentSessions(
    getWorkspaceRoot(),
    new Set(sessions.keys()),
  );
  discovered.forEach((session) => sessions.set(session.id, session));
  const external = await discoverExternalAgentSessions(
    ["desktop", "documents", "downloads", "pictures"].map((name) =>
      app.getPath(name as "desktop" | "documents" | "downloads" | "pictures"),
    ),
    new Set(sessions.keys()),
  );
  external.forEach((session) => sessions.set(session.id, session));
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
          session.messages = mergeAgentRuntimeMessages(
            session.messages,
            restored.messages,
          );
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
    autoReplyTextEnabled: false,
    autoFileAttachmentEnabled: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    parentSessionID: params.parentSessionID,
    collaborationID: params.collaborationID,
    gatewayRunID: params.gatewayRunID,
    messages: [],
    turns: [],
    interactions: [],
  };
  if (!params.title?.trim()) {
    session.title =
      params.kind === "bot" ? "Bot Requests" : `Agent Session ${sessions.size + 1}`;
  }
  sessions.set(id, session);
  if (params.activate !== false) {
    state.activeSessionByConversation[params.conversationID] = id;
  }
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

const executeCollaborationRun = async (params: {
  parentSessionID: string;
  collaborationID: string;
  runID: string;
  title: string;
  prompt: string;
  timeoutMs?: number;
  onState?: (
    state: "running" | "waiting_permission" | "waiting_question",
  ) => void | Promise<void>;
}) => {
  await ensureInitialized();
  const parent = sessions.get(params.parentSessionID);
  if (!parent || parent.archived) throw new Error("Parent Agent session not found");
  let workerSession = [...sessions.values()].find(
    (session) => session.gatewayRunID === params.runID && !session.archived,
  );
  if (!workerSession) {
    workerSession = await createSession({
      conversationID: parent.conversationID,
      title: `协作 · ${params.title}`,
      liveHistoryEnabled: parent.liveHistoryEnabled,
      activate: false,
      parentSessionID: parent.id,
      collaborationID: params.collaborationID,
      gatewayRunID: params.runID,
    });
  }
  const turn = await queueMessage({
    sessionID: workerSession.id,
    text: params.prompt,
    source: "context",
  });
  const timeoutAt = Date.now() + (params.timeoutMs ?? 30 * 60_000);
  let reportedState: "running" | "waiting_permission" | "waiting_question" | undefined;
  while (Date.now() < timeoutAt) {
    const current = sessions.get(workerSession.id);
    const currentTurn = current?.turns.find((candidate) => candidate.id === turn.id);
    if (!current || !currentTurn) {
      throw new Error("Collaboration worker session disappeared");
    }
    const state =
      current.status === "waiting_permission" || current.status === "waiting_question"
        ? current.status
        : currentTurn.status === "running"
        ? "running"
        : undefined;
    if (state && state !== reportedState) {
      reportedState = state;
      await params.onState?.(state);
    }
    if (currentTurn.status === "failed" || currentTurn.status === "cancelled") {
      throw new Error(
        currentTurn.lastError ?? `Collaboration turn ${currentTurn.status}`,
      );
    }
    if (currentTurn.status === "completed") {
      await refreshMessages(current);
      const userMessageIndex = current.messages.findIndex(
        (message) => message.id === `local_${turn.id}`,
      );
      const assistantMessages = current.messages
        .slice(Math.max(0, userMessageIndex + 1))
        .filter(
          (message) =>
            message.role === "assistant" &&
            message.parts.some((part) => part.type === "text" || part.type === "file"),
        );
      if (assistantMessages.length === 0) {
        throw new Error("Collaboration worker completed without an assistant result");
      }
      const delivery = await resolveAgentDelivery(
        current.workspacePath,
        assistantMessages,
      );
      return {
        text: delivery.text,
        artifacts: delivery.attachments,
        workerSessionID: current.id,
        workspacePath: current.workspacePath,
      };
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  if (workerSession.runtimeSessionID) {
    await adapter
      .abort({
        workspacePath: workerSession.workspacePath,
        runtimeSessionID: workerSession.runtimeSessionID,
      })
      .catch(() => undefined);
  }
  throw new Error("Collaboration worker timed out");
};

const getOrCreateBotSession = async (conversationID: string) => {
  const existing = [...sessions.values()]
    .filter(
      (session) =>
        session.conversationID === conversationID &&
        session.kind === "bot" &&
        !session.archived,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
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
  async getSession(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    return session ? structuredClone(session) : undefined;
  },
  async appendCollaborationMessage(params: {
    sessionID: string;
    eventID: string;
    collaborationID: string;
    sequence: number;
    eventType: string;
    text: string;
    role?: "system" | "assistant";
    createdAt?: number;
    notify?: boolean;
    artifacts?: Array<{
      nativePath: string;
      fileName?: string;
      kind?: string;
      size?: number;
    }>;
  }) {
    await ensureInitialized();
    const session = sessions.get(params.sessionID);
    if (!session || session.archived) throw new Error("Agent session not found");
    const messageID = `collaboration_${params.eventID}`;
    const existing = session.messages.find((message) => message.id === messageID);
    if (existing) return structuredClone(existing);
    const timestamp = params.createdAt ?? Date.now();
    const message: AgentMessage = {
      id: messageID,
      sessionID: session.id,
      role: params.role ?? "system",
      createdAt: timestamp,
      completedAt: timestamp,
      parts: [
        {
          id: `${messageID}_part`,
          type: "text",
          text: params.text,
          metadata: {
            collaborationID: params.collaborationID,
            collaborationEventID: params.eventID,
            collaborationSequence: params.sequence,
            collaborationEventType: params.eventType,
          },
        },
        ...(params.artifacts ?? []).map((artifact, index) => ({
          id: `${messageID}_artifact_${index}`,
          type: "file" as const,
          name: artifact.fileName,
          path: artifact.nativePath,
          status: "completed",
          metadata: {
            collaborationID: params.collaborationID,
            kind: artifact.kind,
            size: artifact.size,
          },
        })),
      ],
    };
    session.messages.push(message);
    session.updatedAt = Math.max(session.updatedAt, timestamp);
    await persistSessionFiles(session);
    if (params.notify) {
      notifySession(session, "Agent collaboration needs attention", params.text);
    }
    publish();
    return structuredClone(message);
  },
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
    if (params.model) session.model = params.model;
    if (
      typeof params.autoReplyTextEnabled === "boolean" &&
      params.autoReplyTextEnabled !== session.autoReplyTextEnabled
    ) {
      session.autoReplyTextEnabled = params.autoReplyTextEnabled;
      session.autoReplyTextEnabledAt = params.autoReplyTextEnabled
        ? Date.now()
        : undefined;
    }
    if (
      typeof params.autoFileAttachmentEnabled === "boolean" &&
      params.autoFileAttachmentEnabled !== session.autoFileAttachmentEnabled
    ) {
      session.autoFileAttachmentEnabled = params.autoFileAttachmentEnabled;
      session.autoFileAttachmentEnabledAt = params.autoFileAttachmentEnabled
        ? Date.now()
        : undefined;
    }
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
  async listModels(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session || session.archived) throw new Error("Agent session not found");
    return adapter.listModels({ workspacePath: session.workspacePath });
  },
  async archiveSession(sessionID: string) {
    await ensureInitialized();
    const session = sessions.get(sessionID);
    if (!session) return undefined;
    session.archived = true;
    session.status = "archived";
    session.updatedAt = Date.now();
    autoApproveSessionIDs.delete(sessionID);
    pendingDeliveryRequests.delete(sessionID);
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
  executeCollaborationRun,
  async handleDeliveryResponse(response: AgentDeliveryResponse) {
    await ensureInitialized();
    const session = sessions.get(response.sessionID);
    if (!session) return;
    if (pendingDeliveryRequests.get(session.id) !== response.requestID) return;
    pendingDeliveryRequests.delete(session.id);
    if (response.textSent) session.lastAutoReplyMessageID = response.messageID;
    if (response.sentAttachmentPaths.length > 0) {
      session.lastAutoAttachmentMessageID = response.messageID;
    }
    if (response.errors?.length) {
      session.lastError = `Automatic IM delivery: ${response.errors.join("; ")}`;
      notifySession(session, "Automatic Agent delivery failed", session.title);
    }
    session.updatedAt = Date.now();
    await persistSessionFiles(session);
    publish();
  },
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
  setViewport(next: typeof viewport) {
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
    state.activeSessionByConversation[request.conversationID] = session.id;
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
    streamPublishTimers.forEach(clearTimeout);
    streamPublishTimers.clear();
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
