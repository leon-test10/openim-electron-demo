import {
  CodexBindingDetail,
  CodexBridgeMeta,
  CodexConversationStatus,
  CodexRuntimeEvent,
  CodexRuntimeJob,
  CodexSessionRecord,
  CreateCodexSessionInput,
  RebindCodexInput,
} from "@/types/codex";
import { getViteEnv } from "@/utils/env";

const bridgeBaseUrl = getViteEnv(
  "VITE_CODEX_BRIDGE_URL",
  "http://127.0.0.1:8787",
).replace(/\/$/, "");

interface BridgeErrorBody {
  error?: string;
  message?: string;
  statusCode?: number;
}

const emptyJsonBody = JSON.stringify({});

async function requestBridge<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    const parsed = parseBridgeErrorBody(rawBody);
    const message = parsed?.message || rawBody || response.statusText;
    const legacyHint =
      response.status === 404 && message.toLowerCase().includes("route")
        ? " Bridge may be running an older version; restart openim-codex-bridge."
        : "";
    throw new Error(
      `Codex bridge request failed: HTTP ${response.status} ${message}${legacyHint}`,
    );
  }

  return response.json() as Promise<T>;
}

function parseBridgeErrorBody(rawBody: string): BridgeErrorBody | null {
  try {
    return JSON.parse(rawBody) as BridgeErrorBody;
  } catch {
    return null;
  }
}

export function getCodexBridgeMeta() {
  return requestBridge<CodexBridgeMeta>("/api/meta");
}

export function getCodexStatus(conversationID: string) {
  return requestBridge<CodexConversationStatus>(
    `/api/conversations/${encodeURIComponent(conversationID)}/status`,
  );
}

export function getCodexBinding(conversationID: string) {
  return requestBridge<CodexBindingDetail>(
    `/api/bindings/${encodeURIComponent(conversationID)}`,
  );
}

export function getCodexSessions(conversationID: string) {
  return requestBridge<{ conversationId: string; sessions: CodexSessionRecord[] }>(
    `/api/conversations/${encodeURIComponent(conversationID)}/codex-sessions`,
  );
}

export function createCodexSession(
  conversationID: string,
  payload: CreateCodexSessionInput,
) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(conversationID)}/codex-sessions`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function activateCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/activate`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function updateCodexSession(
  conversationID: string,
  sessionRecordID: string,
  payload: { displayName: string },
) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function archiveCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/archive`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function getCodexJobEvents(jobID: string, afterSequence = 0) {
  const query = afterSequence > 0 ? `?after=${afterSequence}` : "";
  return requestBridge<{ jobId: string; events: CodexRuntimeEvent[] }>(
    `/api/jobs/${encodeURIComponent(jobID)}/events${query}`,
  );
}

export function getCodexJobEventsStreamUrl(jobID: string, afterSequence = 0) {
  const query = afterSequence > 0 ? `?after=${afterSequence}` : "";
  return `${bridgeBaseUrl}/api/jobs/${encodeURIComponent(jobID)}/events/stream${query}`;
}

export function cancelCodexJob(jobID: string) {
  return requestBridge<CodexRuntimeJob>(
    `/api/jobs/${encodeURIComponent(jobID)}/cancel`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function retryCodexJob(jobID: string) {
  return requestBridge<CodexRuntimeJob>(
    `/api/jobs/${encodeURIComponent(jobID)}/retry`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function rebindCodexConversation(
  conversationID: string,
  payload: RebindCodexInput,
) {
  return requestBridge<CodexBindingDetail>(
    `/api/bindings/${encodeURIComponent(conversationID)}/rebind`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function archiveCodexConversation(conversationID: string) {
  return requestBridge<{
    openimConversationId: string;
    archivedSession: CodexBindingDetail["activeSession"];
    activeSession: null;
    sessions: CodexBindingDetail["sessions"];
    latestJob: CodexRuntimeJob | null;
    recentJobs: CodexRuntimeJob[];
  }>(`/api/bindings/${encodeURIComponent(conversationID)}/archive`, {
    method: "POST",
    body: emptyJsonBody,
  });
}
