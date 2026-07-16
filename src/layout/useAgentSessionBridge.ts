import { message } from "antd";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { persistAgentContextBundle } from "@/services/agentSessions/context";
import { deliverAgentOutput } from "@/services/agentSessions/delivery";
import { answerAgentHistoryQuery } from "@/services/agentSessions/history";
import {
  useAgentSessionStore,
  useConversationStore,
  useMessageSelectionStore,
} from "@/store";
import type {
  AgentSessionEvent,
  AgentSessionStateSnapshot,
} from "@/types/agentSession";
import emitter, { type IMContextActionParams } from "@/utils/events";

const clearLegacyPanelMetadata = () => {
  if (localStorage.getItem("openim_agent_session_legacy_cleanup_v1") === "1") return;
  localStorage.removeItem("openim_terminal_dock_state");
  localStorage.removeItem("openim_runtime_dock_state");
  localStorage.setItem("openim_agent_session_legacy_cleanup_v1", "1");
};

export const useAgentSessionBridge = () => {
  const navigate = useNavigate();

  useEffect(() => {
    clearLegacyPanelMetadata();
    void useAgentSessionStore.getState().initialize();
    if (!window.electronAPI) return;

    const unsubscribe = window.electronAPI.subscribe(
      "agent-session:event",
      (event: AgentSessionEvent) => {
        if (event.type === "history-query") {
          void answerAgentHistoryQuery(event.request).then((response) =>
            useAgentSessionStore.getState().sendHistoryResponse(response),
          );
          return;
        }
        if (event.type === "delivery-request") {
          void deliverAgentOutput(event.request).then(async (response) => {
            await window.electronAPI?.ipcInvoke(
              "agent-session:deliveryResponse",
              response,
            );
            if (response.errors?.length) {
              message.error(response.errors.join("; "));
            } else {
              const count =
                Number(response.textSent) + response.sentAttachmentPaths.length;
              message.success(`Agent output auto-sent (${count})`);
            }
          });
          return;
        }
        useAgentSessionStore.getState().applyEvent(event);
        if (event.type !== "navigate") return;

        const conversation = useConversationStore
          .getState()
          .conversationList.find(
            (item) => item.conversationID === event.conversationID,
          );
        if (conversation) {
          void useConversationStore.getState().updateCurrentConversation(conversation);
        }
        if (event.sessionID) {
          void useAgentSessionStore
            .getState()
            .selectSession(event.conversationID, event.sessionID);
        }
        void useAgentSessionStore.getState().setPanelState({ agentPanelOpen: true });
        navigate(`/chat/${event.conversationID}`);
      },
    );
    const handleContextAction = async (params: IMContextActionParams) => {
      const conversationID = params.source.conversationID;
      if (!conversationID) return;
      try {
        const store = useAgentSessionStore.getState();
        let session = store.sessions.find(
          (item) =>
            item.id === store.activeSessionByConversation[conversationID] &&
            !item.archived,
        );
        session ??= store.sessions.find(
          (item) => item.conversationID === conversationID && !item.archived,
        );
        if (!session) {
          const sessionID = await store.createSession({
            conversationID,
            title: "IM context session",
          });
          session = useAgentSessionStore
            .getState()
            .sessions.find((item) => item.id === sessionID);
          if (!session) {
            const snapshot =
              await window.electronAPI!.ipcInvoke<AgentSessionStateSnapshot>(
                "agent-session:list",
              );
            session = snapshot.sessions.find((item) => item.id === sessionID);
          }
        }
        if (!session) throw new Error("Unable to create Agent session");

        const selected =
          useMessageSelectionStore.getState().selectedMessagesByConversation[
            conversationID
          ] ?? {};
        const messages = (params.source.messageIDs ?? [])
          .map((id) => selected[id])
          .filter((item) => Boolean(item));
        if (messages.length === 0) throw new Error("Selected messages are unavailable");
        const result = await persistAgentContextBundle({
          session,
          source: {
            kind: params.source.kind,
            conversationID,
            messageIDs: messages.map((item) => item.clientMsgID),
            keyword: params.source.keyword,
          },
          messages,
        });
        await store.setPanelState({ agentPanelOpen: true });
        await store.selectSession(conversationID, session.id);
        if (params.action === "copy") {
          await navigator.clipboard.writeText(result.bundle.promptText);
          message.success("Agent context prompt copied");
        } else if (params.action === "send") {
          await store.sendMessage({
            sessionID: session.id,
            text: result.bundle.promptText,
            source: "context",
            contextPaths: result.paths,
          });
          message.success("Context queued in the Agent session");
        } else {
          store.appendDraft(session.id, result.bundle.promptText);
          message.success("Context preview added to the Agent composer");
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    };
    emitter.on("IM_CONTEXT_ACTION", handleContextAction);
    return () => {
      unsubscribe();
      emitter.off("IM_CONTEXT_ACTION", handleContextAction);
    };
  }, [navigate]);
};
