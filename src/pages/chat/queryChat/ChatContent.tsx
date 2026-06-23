import { Button, Dropdown, Layout, message as antdMessage, Spin } from "antd";
import clsx from "clsx";
import { memo, useEffect, useMemo, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { SystemMessageTypes } from "@/constants/im";
import { useMessageSelectionStore, useTerminalDockStore, useUserStore } from "@/store";
import emitter from "@/utils/events";
import {
  formatMessagesAsMarkdown,
  formatMessagesAsPlainText,
} from "@/utils/messageSelectionFormat";

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
  const selectedMessages = useMemo(
    () =>
      conversationID
        ? Object.values(selectedMessagesByConversation[conversationID] ?? {})
        : [],
    [conversationID, selectedMessagesByConversation],
  );

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

  const copySelectedMessages = async () => {
    if (selectedMessages.length === 0) return;
    await navigator.clipboard.writeText(formatMessagesAsPlainText(selectedMessages));
    antdMessage.success("Selected messages copied");
  };

  const exportSelectedMessages = () => {
    if (selectedMessages.length === 0) return;

    const markdown = formatMessagesAsMarkdown(selectedMessages);
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `selected-messages-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedActionItems = [
    {
      key: "agent",
      label: "Agent",
      children: [
        {
          key: "agent:create-context",
          label: "Create Agent Context",
          disabled: selectedCount === 0,
        },
        {
          key: "agent:copy-prompt",
          label: "Copy Agent Prompt",
          disabled: selectedCount === 0,
        },
        {
          key: "agent:send-terminal",
          label: "Send Prompt to Terminal",
          disabled: selectedCount === 0,
        },
      ],
    },
  ];

  const onSelectedActionClick = ({ key }: { key: string }) => {
    if (key === "agent:create-context") {
      runSelectedContextAction("preview");
    }
    if (key === "agent:copy-prompt") {
      runSelectedContextAction("copy");
    }
    if (key === "agent:send-terminal") {
      runSelectedContextAction("send");
    }
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
          {selectionActive && (
            <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md border border-[#d9e2f3] bg-white/95 px-2 py-1 shadow-sm">
              <>
                <span className="text-xs text-[#667085]">
                  Selected {selectedCount} messages
                </span>
                <Button
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={() => void copySelectedMessages()}
                >
                  Copy
                </Button>
                <Button
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={exportSelectedMessages}
                >
                  Export MD
                </Button>
                <Dropdown
                  menu={{
                    items: selectedActionItems,
                    onClick: onSelectedActionClick,
                  }}
                  trigger={["click"]}
                >
                  <Button size="small">More</Button>
                </Dropdown>
                <Button size="small" onClick={() => clearSelection(conversationID)}>
                  Clear
                </Button>
              </>
            </div>
          )}
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
