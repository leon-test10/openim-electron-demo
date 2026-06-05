import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";

import {
  activateCodexSession,
  archiveCodexConversation,
  archiveCodexSession,
  cancelCodexJob,
  createCodexSession,
  getCodexBridgeMeta,
  getCodexJobEvents,
  getCodexJobEventsStreamUrl,
  getCodexSessions,
  getCodexStatus,
  rebindCodexConversation,
  retryCodexJob,
  updateCodexSession,
} from "@/api/codexBridge";
import { useCodexStore, useConversationStore, useUserStore } from "@/store";
import {
  CodexBridgeMeta,
  CodexRuntimeEvent,
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
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [conversationID, isCodexConversation, refresh]);

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

    if (!activeJob?.id) {
      return () => {
        closed = true;
      };
    }

    const events =
      useCodexStore.getState().conversations[conversationID]?.eventsByJobId[
        activeJob.id
      ] ?? [];
    const lastSequence = events.length ? events[events.length - 1].sequence : 0;
    const source = new EventSource(
      getCodexJobEventsStreamUrl(activeJob.id, lastSequence),
    );
    source.addEventListener("runtime_event", (event: MessageEvent<string>) => {
      const parsed = JSON.parse(event.data) as CodexRuntimeEvent;
      appendJobEvents(conversationID, activeJob.id, [parsed]);
    });
    source.addEventListener("done", () => {
      source.close();
      void refresh();
    });
    source.onerror = () => {
      source.close();
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [
    actionableJob?.id,
    activeJob?.id,
    appendJobEvents,
    conversationID,
    isCodexConversation,
    refresh,
    setError,
    setJobEvents,
  ]);

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
