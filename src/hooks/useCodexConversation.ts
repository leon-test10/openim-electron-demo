import { MessageItem, ViewType } from "@openim/wasm-client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  activateCodexSession,
  archiveCodexConversation,
  archiveCodexSession,
  cancelCodexJob,
  createCodexSession,
  deleteCodexSession,
  getCodexBridgeMeta,
  getCodexConversationEventsStreamUrl,
  getCodexJobEvents,
  getCodexSessionDiagnostics,
  getCodexSessions,
  getCodexStatus,
  postOpenImHistorySnapshot,
  rebindCodexConversation,
  restoreCodexSession,
  retryCodexJob,
  updateCodexSession,
} from "@/api/codexBridge";
import { IMSDK } from "@/layout/MainContentWrap";
import { useCodexStore, useConversationStore, useUserStore } from "@/store";
import {
  CodexBridgeMeta,
  CodexConversationStreamEvent,
  CreateCodexSessionInput,
  RebindCodexInput,
} from "@/types/codex";
import {
  isCodexSingleConversation,
  resolveCodexConversationID,
} from "@/utils/codexConversation";
import { getViteEnv } from "@/utils/env";

const CODEX_BOT_USER_ID = getViteEnv("VITE_CODEX_BOT_USER_ID", "codex_bot");
const POLL_INTERVAL_MS = 2000;

export function useCodexConversation() {
  const { conversationID: routeConversationID } = useParams();
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const selfUserID = useUserStore((state) => state.selfInfo.userID);
  const conversationID = resolveCodexConversationID(
    currentConversation,
    routeConversationID,
  );
  const isCodexConversation = isCodexSingleConversation(
    currentConversation,
    routeConversationID,
    CODEX_BOT_USER_ID,
  );

  const entry = useCodexStore((state) =>
    conversationID ? state.conversations[conversationID] : undefined,
  );
  const setLoading = useCodexStore((state) => state.setLoading);
  const meta = useCodexStore((state) => state.meta);
  const setMeta = useCodexStore((state) => state.setMeta);
  const setStatus = useCodexStore((state) => state.setStatus);
  const setSessions = useCodexStore((state) => state.setSessions);
  const upsertSession = useCodexStore((state) => state.upsertSession);
  const activateSessionLocal = useCodexStore((state) => state.activateSessionLocal);
  const setJobEvents = useCodexStore((state) => state.setJobEvents);
  const appendJobEvents = useCodexStore((state) => state.appendJobEvents);
  const setError = useCodexStore((state) => state.setError);
  const importedHistoryRequestIds = useRef(new Set<string>());
  const [conversationSseFailed, setConversationSseFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!conversationID || !isCodexConversation) return;
    setLoading(conversationID, true);
    try {
      if (!useCodexStore.getState().meta) {
        await getCodexBridgeMeta()
          .then(setMeta)
          .catch((error) => {
            setError(
              conversationID,
              error instanceof Error ? error.message : String(error),
            );
          });
      }
      const status = await getCodexStatus(conversationID);
      setStatus(conversationID, status);
      const sessions = await getCodexSessions(conversationID);
      setSessions(conversationID, sessions.sessions);
    } catch (error) {
      setError(conversationID, error instanceof Error ? error.message : String(error));
    }
  }, [
    conversationID,
    isCodexConversation,
    setError,
    setLoading,
    setMeta,
    setSessions,
    setStatus,
  ]);

  useEffect(() => {
    if (!conversationID || !isCodexConversation) return;
    setConversationSseFailed(false);
  }, [conversationID, isCodexConversation]);

  useEffect(() => {
    if (!conversationID || !isCodexConversation) return;
    if (conversationSseFailed) return;
    if (typeof EventSource === "undefined") {
      setConversationSseFailed(true);
      return;
    }
    void refresh();
    const source = new EventSource(getCodexConversationEventsStreamUrl(conversationID));
    const refreshOnEvent = () => {
      void refresh();
    };
    const onRuntimeEvent = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as CodexConversationStreamEvent;
        const runtimeEvent = parsed.payload.runtimeEvent;
        if (runtimeEvent) {
          appendJobEvents(conversationID, runtimeEvent.jobId, [runtimeEvent]);
        }
      } catch (error) {
        setError(
          conversationID,
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    const eventTypes: Array<CodexConversationStreamEvent["type"]> = [
      "job_created",
      "job_queued",
      "job_started",
      "job_succeeded",
      "job_failed",
      "job_cancelled",
      "session_changed",
      "binding_changed",
      "history_import_requested",
    ];
    eventTypes.forEach((type) => source.addEventListener(type, refreshOnEvent));
    source.addEventListener("runtime_event", onRuntimeEvent);
    source.onerror = () => {
      source.close();
      setConversationSseFailed(true);
    };
    return () => {
      eventTypes.forEach((type) => source.removeEventListener(type, refreshOnEvent));
      source.removeEventListener("runtime_event", onRuntimeEvent);
      source.close();
    };
  }, [
    appendJobEvents,
    conversationID,
    conversationSseFailed,
    isCodexConversation,
    refresh,
    setError,
  ]);

  useEffect(() => {
    if (!conversationID || !isCodexConversation || !conversationSseFailed) return;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [conversationID, conversationSseFailed, isCodexConversation, refresh]);

  useEffect(() => {
    const pending = entry?.status?.pendingHistoryImport;
    if (!conversationID || !isCodexConversation || !pending) return;
    if (importedHistoryRequestIds.current.has(pending.id)) return;
    importedHistoryRequestIds.current.add(pending.id);
    void importOpenImHistory(conversationID, pending.id, pending.requestedCount)
      .then(() => refresh())
      .catch((error) => {
        importedHistoryRequestIds.current.delete(pending.id);
        setError(
          conversationID,
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [
    conversationID,
    entry?.status?.pendingHistoryImport,
    isCodexConversation,
    refresh,
    setError,
  ]);

  const activeJob = entry?.status?.activeJob;
  const latestJob = entry?.status?.latestJob;
  const actionableJob = activeJob ?? latestJob;
  const activeJobEvents =
    actionableJob && conversationID ? entry?.eventsByJobId[actionableJob.id] ?? [] : [];

  useEffect(() => {
    if (!conversationID || !isCodexConversation || !actionableJob?.id) return;
    let closed = false;

    void getCodexJobEvents(actionableJob.id)
      .then(({ events }) => {
        if (!closed) {
          setJobEvents(conversationID, actionableJob.id, events);
        }
      })
      .catch((error) => {
        if (!closed) {
          setError(
            conversationID,
            error instanceof Error ? error.message : String(error),
          );
        }
      });

    return () => {
      closed = true;
    };
  }, [actionableJob?.id, conversationID, isCodexConversation, setError, setJobEvents]);

  const actions = useMemo(
    () => ({
      refresh,
      meta,
      loadJobEvents: async (jobID: string) => {
        if (!conversationID) return;
        const { events } = await getCodexJobEvents(jobID);
        setJobEvents(conversationID, jobID, events);
      },
      cancel: async () => {
        if (!activeJob?.id || !activeJob.canCancel) return;
        await cancelCodexJob(activeJob.id);
        await refresh();
      },
      retry: async (jobID?: string) => {
        const sourceJobID = jobID ?? latestJob?.id;
        if (!sourceJobID) return;
        await retryCodexJob(sourceJobID);
        await refresh();
      },
      rebind: async (payload: RebindCodexInput) => {
        if (!conversationID) return;
        await rebindCodexConversation(conversationID, {
          openimDisplayUserId: selfUserID,
          ...payload,
        });
        await refresh();
      },
      archive: async () => {
        if (!conversationID) return;
        await archiveCodexConversation(conversationID);
        await refresh();
      },
      archiveSession: async (sessionRecordID: string) => {
        if (!conversationID) return;
        await ensureCapability("sessionArchive", conversationID, setMeta);
        await archiveCodexSession(conversationID, sessionRecordID);
        await refresh();
      },
      restoreSession: async (sessionRecordID: string) => {
        if (!conversationID) return;
        await ensureCapability("sessionRestore", conversationID, setMeta);
        await restoreCodexSession(conversationID, sessionRecordID);
        await refresh();
      },
      deleteSession: async (sessionRecordID: string) => {
        if (!conversationID) return;
        await ensureCapability("sessionDelete", conversationID, setMeta);
        await deleteCodexSession(conversationID, sessionRecordID);
        await refresh();
      },
      renameSession: async (sessionRecordID: string, displayName: string) => {
        if (!conversationID) return;
        const session = await updateCodexSession(conversationID, sessionRecordID, {
          displayName,
        });
        upsertSession(conversationID, session);
        await refresh();
      },
      createSession: async (payload: CreateCodexSessionInput = {}) => {
        if (!conversationID) return;
        await ensureCapability("sessionActivate", conversationID, setMeta);
        const session = await createCodexSession(conversationID, {
          openimDisplayUserId: selfUserID,
          ...payload,
        });
        activateSessionLocal(conversationID, session);
        await refresh();
        return session;
      },
      activateSession: async (sessionRecordID: string) => {
        if (!conversationID) return;
        await ensureCapability("sessionActivate", conversationID, setMeta);
        const session = await activateCodexSession(conversationID, sessionRecordID);
        activateSessionLocal(conversationID, session);
        await refresh();
      },
      getSessionDiagnostics: async (sessionRecordID: string) => {
        if (!conversationID) return null;
        return getCodexSessionDiagnostics(conversationID, sessionRecordID);
      },
    }),
    [
      activateSessionLocal,
      activeJob,
      conversationID,
      latestJob,
      meta,
      refresh,
      selfUserID,
      setJobEvents,
      setMeta,
      upsertSession,
    ],
  );

  return {
    conversationID,
    isCodexConversation,
    status: entry?.status ?? null,
    loading: entry?.loading ?? false,
    error: entry?.error ?? null,
    activeJob,
    latestJob,
    actionableJob,
    sessions: entry?.sessions ?? [],
    queuedJobCount: entry?.status?.queuedJobCount ?? 0,
    activeJobEvents,
    eventsByJobId: entry?.eventsByJobId ?? {},
    ...actions,
  };
}

async function importOpenImHistory(
  conversationID: string,
  requestID: string,
  requestedCount: number,
) {
  const { data } = await IMSDK.getAdvancedHistoryMessageList({
    count: Math.min(Math.max(requestedCount, 1), 200),
    startClientMsgID: "",
    conversationID,
    viewType: ViewType.History,
  });
  await postOpenImHistorySnapshot(conversationID, {
    requestId: requestID,
    source: "electron-sdk",
    messages: (data.messageList ?? []).map(toSnapshotMessage),
  });
}

function toSnapshotMessage(message: MessageItem) {
  return {
    clientMsgID: message.clientMsgID,
    serverMsgID: message.serverMsgID,
    sendID: message.sendID,
    senderNickname: message.senderNickname,
    contentType: message.contentType,
    sendTime: message.sendTime,
    text: message.textElem?.content,
    preview: message.textElem?.content || message.fileElem?.fileName,
  };
}

async function ensureCapability(
  capability: keyof CodexBridgeMeta["capabilities"],
  conversationID: string,
  setMeta: (meta: CodexBridgeMeta) => void,
) {
  let meta = useCodexStore.getState().meta;
  if (!meta) {
    try {
      meta = await getCodexBridgeMeta();
      setMeta(meta);
    } catch (error) {
      throw new Error(
        `Codex bridge needs restart or is version-mismatched. Missing capability endpoint. ${formatErrorMessage(
          error,
        )}`,
      );
    }
  }
  if (!meta.capabilities?.[capability]) {
    throw new Error(
      `Codex bridge needs restart or is version-mismatched. Missing capability: ${capability}. Conversation: ${conversationID}`,
    );
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
