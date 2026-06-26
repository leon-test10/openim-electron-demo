import { SessionType } from "@openim/wasm-client-sdk";
import { Layout, Spin } from "antd";
import clsx from "clsx";
import { memo, useEffect, useMemo, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { SystemMessageTypes } from "@/constants/im";
import {
  BotTargetCandidate,
  createPendingAgentRequest,
  detectBotTrigger,
  extractTextMessageContent,
  isAgentGeneratedMessage,
} from "@/services/botTrigger";
import {
  useConversationStore,
  useMessageSelectionStore,
  usePendingAgentRequestStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import emitter from "@/utils/events";

import MessageItem from "./MessageItem";
import MessageSelectionBoundary from "./MessageSelectionBoundary";
import MessageSelectionToolbar from "./MessageSelectionToolbar";
import NotificationMessage from "./NotificationMessage";
import PendingAgentRequests from "./PendingAgentRequests";
import { useHistoryMessageList } from "./useHistoryMessageList";

const ChatContent = () => {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const selfUserID = useUserStore((state) => state.selfInfo.userID);
  const selfNickname = useUserStore((state) => state.selfInfo.nickname);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const currentMemberInGroup = useConversationStore(
    (state) => state.currentMemberInGroup,
  );
  const botDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.botDetectionEnabled,
  );
  const addPendingAgentRequest = usePendingAgentRequestStore(
    (state) => state.addRequest,
  );
  const promoteToAutoInject = usePendingAgentRequestStore(
    (state) => state.promoteToAutoInject,
  );
  const autoInjectEnabled = useTerminalDockStore((state) => state.autoInjectEnabled);
  const activeSelectionConversationID = useMessageSelectionStore(
    (state) => state.activeConversationID,
  );

  const scrollToBottom = () => {
    setTimeout(() => {
      virtuoso.current?.scrollToIndex({
        index: 9999,
        align: "end",
        behavior: "auto",
      });
    });
  };

  const { SPLIT_COUNT, conversationID, loadState, moreOldLoading, getMoreOldMessages } =
    useHistoryMessageList();
  const selectionAnchorMessageID = useMessageSelectionStore((state) =>
    conversationID
      ? state.selectionAnchorMessageIDByConversation[conversationID]
      : undefined,
  );
  const messageIDSignature = useMemo(
    () => loadState.messageList.map((message) => message.clientMsgID).join("|"),
    [loadState.messageList],
  );
  const selectionActive =
    Boolean(conversationID) && activeSelectionConversationID === conversationID;
  const selectionAnchorIndex = useMemo(() => {
    if (!selectionActive || loadState.messageList.length === 0) return -1;
    if (!selectionAnchorMessageID) return 0;

    return Math.max(
      0,
      loadState.messageList.findIndex(
        (message) => message.clientMsgID === selectionAnchorMessageID,
      ),
    );
  }, [loadState.messageList, selectionActive, selectionAnchorMessageID]);
  const botTargetCandidates = useMemo<BotTargetCandidate[]>(() => {
    const candidates: Array<BotTargetCandidate | undefined> = [
      {
        userID: selfUserID,
        nickname: currentMemberInGroup?.nickname || selfNickname,
      },
      currentConversation?.conversationType === SessionType.Single
        ? {
            userID: currentConversation.userID,
            nickname: currentConversation.showName,
          }
        : undefined,
    ];

    return candidates.filter((candidate): candidate is BotTargetCandidate =>
      Boolean(candidate?.userID),
    );
  }, [
    currentConversation?.conversationType,
    currentConversation?.showName,
    currentConversation?.userID,
    currentMemberInGroup?.nickname,
    selfNickname,
    selfUserID,
  ]);

  useEffect(() => {
    emitter.on("CHAT_LIST_SCROLL_TO_BOTTOM", scrollToBottom);
    return () => {
      emitter.off("CHAT_LIST_SCROLL_TO_BOTTOM", scrollToBottom);
    };
  }, []);

  const loadMoreMessage = () => {
    if (!loadState.hasMoreOld || moreOldLoading) return;

    getMoreOldMessages();
  };

  useEffect(() => {
    if (!botDetectionEnabled || !conversationID || !selfUserID) return;

    const recentLimit = 20;
    const conversationType =
      currentConversation?.conversationType === SessionType.Group ? "group" : "single";

    loadState.messageList.forEach((message, index) => {
      if (isAgentGeneratedMessage(message)) return;

      const text = extractTextMessageContent(message);
      const trigger = detectBotTrigger({
        text,
        currentUserID: selfUserID,
        conversationType,
        targetCandidates: botTargetCandidates,
      });

      if (!trigger) return;

      // Only process triggers targeting this user (or no specific target).
      if (trigger.targetUserID && trigger.targetUserID !== selfUserID) return;

      const contextMessages = loadState.messageList.slice(
        Math.max(0, index - recentLimit + 1),
        index + 1,
      );

      const request = createPendingAgentRequest({
        conversationID,
        triggerMessage: message,
        trigger,
        contextMessages,
        isGroup: conversationType === "group",
        recentLimit,
      });

      if (autoInjectEnabled) {
        const terminalDockState = useTerminalDockStore.getState();
        const activeWorkspaceID = terminalDockState.activeWorkspaceID;
        const activeWorkspace = terminalDockState.workspaces.find(
          (workspace) => workspace.id === activeWorkspaceID,
        );
        const activeTabID = activeWorkspaceID
          ? terminalDockState.activeTabByWorkspace[activeWorkspaceID]
          : undefined;
        const activeTab = activeWorkspaceID
          ? terminalDockState.tabsByWorkspace[activeWorkspaceID]?.find(
              (tab) => tab.id === activeTabID,
            )
          : undefined;
        const canAutoInject =
          Boolean(activeWorkspace?.linkedConversationIDs.includes(conversationID)) &&
          Boolean(activeTab && activeTab.status === "running");

        if (!canAutoInject) {
          addPendingAgentRequest(request);
          return;
        }

        const triggerKey = `${conversationID}|${request.triggerMessageID}`;
        if (terminalDockState.hasHandledBotTrigger(triggerKey)) return;

        const existingRequest =
          usePendingAgentRequestStore
            .getState()
            .requestsByConversation[conversationID]?.some(
              (item) => item.triggerMessageID === request.triggerMessageID,
            ) ?? false;
        if (existingRequest) return;

        terminalDockState.markBotTriggerHandled(triggerKey);
        // Auto-inject: mark as sent immediately and notify TerminalDock.
        addPendingAgentRequest({
          ...request,
          status: "sent",
        });
        emitter.emit("BOT_AGENT_REQUEST_ACTION", {
          request,
          action: "send",
        });
      } else {
        addPendingAgentRequest(request);
      }
    });
  }, [
    addPendingAgentRequest,
    autoInjectEnabled,
    botTargetCandidates,
    botDetectionEnabled,
    conversationID,
    currentConversation?.conversationType,
    loadState.messageList,
    messageIDSignature,
    selfUserID,
  ]);

  // When auto-inject is enabled, promote any existing pending requests to sent
  // and emit BOT_AGENT_REQUEST_ACTION for each.
  useEffect(() => {
    if (!autoInjectEnabled || !botDetectionEnabled || !conversationID) return;
    const terminalDockState = useTerminalDockStore.getState();
    const activeWorkspaceID = terminalDockState.activeWorkspaceID;
    const activeWorkspace = terminalDockState.workspaces.find(
      (workspace) => workspace.id === activeWorkspaceID,
    );
    const activeTabID = activeWorkspaceID
      ? terminalDockState.activeTabByWorkspace[activeWorkspaceID]
      : undefined;
    const activeTab = activeWorkspaceID
      ? terminalDockState.tabsByWorkspace[activeWorkspaceID]?.find(
          (tab) => tab.id === activeTabID,
        )
      : undefined;
    const canAutoInject =
      Boolean(activeWorkspace?.linkedConversationIDs.includes(conversationID)) &&
      Boolean(activeTab && activeTab.status === "running");

    if (!canAutoInject) return;

    const pendingRequests =
      usePendingAgentRequestStore.getState().requestsByConversation[conversationID] ??
      [];

    const pendingForSelf = pendingRequests.filter(
      (r) =>
        r.status === "pending" && (!r.targetUserID || r.targetUserID === selfUserID),
    );

    if (pendingForSelf.length === 0) return;

    promoteToAutoInject(conversationID);

    for (const request of pendingForSelf) {
      useTerminalDockStore
        .getState()
        .markBotTriggerHandled(`${conversationID}|${request.triggerMessageID}`);
      emitter.emit("BOT_AGENT_REQUEST_ACTION", {
        request,
        action: "send",
      });
    }
  }, [
    autoInjectEnabled,
    botDetectionEnabled,
    conversationID,
    selfUserID,
    promoteToAutoInject,
  ]);

  return (
    <Layout.Content
      className="relative flex h-full overflow-hidden !bg-white"
      id="chat-main"
    >
      {loadState.initLoading ? (
        <div className="flex h-full w-full items-center justify-center bg-white pt-1">
          <Spin spinning />
        </div>
      ) : (
        <>
          {selectionActive && (
            <MessageSelectionToolbar conversationID={conversationID} />
          )}
          <PendingAgentRequests conversationID={conversationID} />
          <Virtuoso
            id="chat-list"
            className="w-full overflow-x-hidden"
            followOutput="smooth"
            firstItemIndex={loadState.firstItemIndex}
            initialTopMostItemIndex={SPLIT_COUNT - 1}
            startReached={loadMoreMessage}
            ref={virtuoso}
            data={loadState.messageList}
            components={{
              Header: () =>
                loadState.hasMoreOld ? (
                  <div
                    className={clsx(
                      "flex justify-center py-2 opacity-0",
                      moreOldLoading && "opacity-100",
                    )}
                  >
                    <Spin />
                  </div>
                ) : null,
            }}
            computeItemKey={(_, item) => item.clientMsgID}
            itemContent={(index, message) => {
              if (SystemMessageTypes.includes(message.contentType)) {
                return (
                  <NotificationMessage key={message.clientMsgID} message={message} />
                );
              }
              const isSender = selfUserID === message.sendID;
              return (
                <>
                  {selectionActive && index === selectionAnchorIndex && (
                    <MessageSelectionBoundary
                      anchored={Boolean(selectionAnchorMessageID)}
                      onClick={() =>
                        conversationID &&
                        useMessageSelectionStore
                          .getState()
                          .clearSelection(conversationID)
                      }
                    />
                  )}
                  <MessageItem
                    key={message.clientMsgID}
                    conversationID={conversationID}
                    message={message}
                    messageUpdateFlag={message.senderNickname + message.senderFaceUrl}
                    isSender={isSender}
                    selectionVisible={!selectionActive || index >= selectionAnchorIndex}
                  />
                </>
              );
            }}
          />
        </>
      )}
    </Layout.Content>
  );
};

export default memo(ChatContent);
