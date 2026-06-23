import { Button, Layout, Spin } from "antd";
import clsx from "clsx";
import { memo, useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { SystemMessageTypes } from "@/constants/im";
import { useMessageSelectionStore, useTerminalDockStore, useUserStore } from "@/store";
import emitter from "@/utils/events";

import MessageItem from "./MessageItem";
import NotificationMessage from "./NotificationMessage";
import { useHistoryMessageList } from "./useHistoryMessageList";

const ChatContent = () => {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const selfUserID = useUserStore((state) => state.selfInfo.userID);
  const activeSelectionConversationID = useMessageSelectionStore(
    (state) => state.activeConversationID,
  );
  const selectedMessagesByConversation = useMessageSelectionStore(
    (state) => state.selectedMessagesByConversation,
  );
  const setSelectionMode = useMessageSelectionStore((state) => state.setSelectionMode);
  const clearSelection = useMessageSelectionStore((state) => state.clearSelection);
  const setTerminalPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);

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
  const selectionActive =
    Boolean(conversationID) && activeSelectionConversationID === conversationID;
  const selectedCount = conversationID
    ? Object.keys(selectedMessagesByConversation[conversationID] ?? {}).length
    : 0;

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

  const runSelectedContextAction = (action: "preview" | "copy" | "send") => {
    setTerminalPanelOpen(true);
    emitter.emit("TERMINAL_CONTEXT_ACTION", {
      source: "selectedMessages",
      action,
    });
  };

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
          <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md border border-[#d9e2f3] bg-white/95 px-2 py-1 shadow-sm">
            {selectionActive ? (
              <>
                <span className="text-xs text-[#667085]">
                  Selected {selectedCount} messages
                </span>
                <Button
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={() => runSelectedContextAction("preview")}
                >
                  Create Context
                </Button>
                <Button
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={() => runSelectedContextAction("copy")}
                >
                  Copy Prompt
                </Button>
                <Button
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={() => runSelectedContextAction("send")}
                >
                  Send to Terminal
                </Button>
                <Button size="small" onClick={() => clearSelection(conversationID)}>
                  Clear
                </Button>
              </>
            ) : (
              <Button
                size="small"
                disabled={!conversationID}
                onClick={() => setSelectionMode(conversationID, true)}
              >
                Select Messages
              </Button>
            )}
          </div>
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
