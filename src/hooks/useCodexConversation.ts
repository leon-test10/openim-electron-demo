import { SessionType } from "@openim/wasm-client-sdk";
import { useCallback, useEffect, useMemo } from "react";

import {
  activateCodexSession,
  archiveCodexConversation,
  cancelCodexJob,
  createCodexSession,
  getCodexJobEvents,
  getCodexJobEventsStreamUrl,
  getCodexSessions,
  getCodexStatus,
  rebindCodexConversation,
  retryCodexJob,
} from "@/api/codexBridge";
import { useCodexStore, useConversationStore } from "@/store";
import {
  CodexRuntimeEvent,
  CreateCodexSessionInput,
  RebindCodexInput,
} from "@/types/codex";
import { getViteEnv } from "@/utils/env";

const CODEX_BOT_USER_ID = getViteEnv("VITE_CODEX_BOT_USER_ID", "codex_bot");
const POLL_INTERVAL_MS = 2000;

export function useCodexConversation() {
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const conversationID = currentConversation?.conversationID;
  const isCodexConversation =
    currentConversation?.conversationType === SessionType.Single &&
    currentConversation?.userID === CODEX_BOT_USER_ID;

  const entry = useCodexStore((state) =>
    conversationID ? state.conversations[conversationID] : undefined,
  );
  const setLoading = useCodexStore((state) => state.setLoading);
  const setStatus = useCodexStore((state) => state.setStatus);
  const setSessions = useCodexStore((state) => state.setSessions);
  const setJobEvents = useCodexStore((state) => state.setJobEvents);
  const appendJobEvents = useCodexStore((state) => state.appendJobEvents);
  const setError = useCodexStore((state) => state.setError);

  const refresh = useCallback(async () => {
    if (!conversationID || !isCodexConversation) return;
    setLoading(conversationID, true);
    try {
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
      cancel: async () => {
        if (!activeJob?.id || !activeJob.canCancel) return;
        await cancelCodexJob(activeJob.id);
        await refresh();
      },
      retry: async () => {
        if (!latestJob?.id || !latestJob.canRetry) return;
        await retryCodexJob(latestJob.id);
        await refresh();
      },
      rebind: async (payload: RebindCodexInput) => {
        if (!conversationID) return;
        await rebindCodexConversation(conversationID, {
          openimDisplayUserId: currentConversation?.userID,
          ...payload,
        });
        await refresh();
      },
      archive: async () => {
        if (!conversationID) return;
        await archiveCodexConversation(conversationID);
        await refresh();
      },
      createSession: async (payload: CreateCodexSessionInput = {}) => {
        if (!conversationID) return;
        await createCodexSession(conversationID, {
          openimDisplayUserId: currentConversation?.userID,
          ...payload,
        });
        await refresh();
      },
      activateSession: async (sessionRecordID: string) => {
        if (!conversationID) return;
        await activateCodexSession(conversationID, sessionRecordID);
        await refresh();
      },
    }),
    [activeJob, conversationID, currentConversation?.userID, latestJob, refresh],
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
    ...actions,
  };
}
