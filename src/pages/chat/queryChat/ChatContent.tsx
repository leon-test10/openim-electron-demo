import { SessionType } from "@openim/wasm-client-sdk";
import { Layout, Spin } from "antd";
import clsx from "clsx";
import { memo, useEffect, useMemo, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { SystemMessageTypes } from "@/constants/im";
import {
  createPendingAgentRequest,
  detectBotTrigger,
  extractTextMessageContent,
  isAgentGeneratedMessage,
} from "@/services/botTrigger";
import {
  useConversationStore,
  useMessageSelectionStore,
  usePendingAgentRequestStore,
  useUserStore,
} from "@/store";
import emitter from "@/utils/events";

import MessageItem from "./MessageItem";
import MessageSelectionToolbar from "./MessageSelectionToolbar";
import NotificationMessage from "./NotificationMessage";
import PendingAgentRequests from "./PendingAgentRequests";
import { useHistoryMessageList } from "./useHistoryMessageList";

const ChatContent = () => {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const selfUserID = useUserStore((state) => state.selfInfo.userID);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const botDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.botDetectionEnabled,
  );
  const addPendingAgentRequest = usePendingAgentRequestStore(
    (state) => state.addRequest,
  );
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
  const messageIDSignature = useMemo(
    () => loadState.messageList.map((message) => message.clientMsgID).join("|"),
    [loadState.messageList],
  );
  const selectionActive =
    Boolean(conversationID) && activeSelectionConversationID === conversationID;

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
      if (message.sendID === selfUserID) return;
      if (isAgentGeneratedMessage(message)) return;

      const text = extractTextMessageContent(message);
      const trigger = detectBotTrigger({
        text,
        currentUserID: selfUserID,
        conversationType,
      });

      if (!trigger) return;

      const contextMessages = loadState.messageList.slice(
        Math.max(0, index - recentLimit + 1),
        index + 1,
      );

      addPendingAgentRequest(
        createPendingAgentRequest({
          conversationID,
          triggerMessage: message,
          trigger,
          contextMessages,
          isGroup: conversationType === "group",
          recentLimit,
        }),
      );
    });
  }, [
    addPendingAgentRequest,
    botDetectionEnabled,
    conversationID,
    currentConversation?.conversationType,
    loadState.messageList,
    messageIDSignature,
    selfUserID,
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
            itemContent={(_, message) => {
              if (SystemMessageTypes.includes(message.contentType)) {
                return (
                  <NotificationMessage key={message.clientMsgID} message={message} />
                );
              }
              const isSender = selfUserID === message.sendID;
              return (
                <MessageItem
                  key={message.clientMsgID}
                  conversationID={conversationID}
                  message={message}
                  messageUpdateFlag={message.senderNickname + message.senderFaceUrl}
                  isSender={isSender}
                />
              );
            }}
          />
        </>
      )}
    </Layout.Content>
  );
};

export default memo(ChatContent);
