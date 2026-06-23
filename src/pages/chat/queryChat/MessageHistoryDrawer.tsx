import { MessageItem, ViewType } from "@openim/wasm-client-sdk";
import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  message as antdMessage,
  Segmented,
  Spin,
} from "antd";
import { FC, useCallback, useEffect, useMemo, useState } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { useMessageSelectionStore, useTerminalDockStore } from "@/store";
import emitter from "@/utils/events";
import {
  formatMessagesAsPlainText,
  getMessageSender,
  getMessageTime,
  getPlainMessageContent,
} from "@/utils/messageSelectionFormat";

interface MessageHistoryDrawerProps {
  conversationID?: string;
  open: boolean;
  onClose: () => void;
}

const pageSize = 20;
const quickLoadOptions = [20, 50, 100];

const MessageHistoryDrawer: FC<MessageHistoryDrawerProps> = ({
  conversationID,
  open,
  onClose,
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [quickCount, setQuickCount] = useState(20);
  const selectedMessagesByConversation = useMessageSelectionStore(
    (state) => state.selectedMessagesByConversation,
  );
  const addMessageSelection = useMessageSelectionStore(
    (state) => state.addMessageSelection,
  );
  const setSelectionMode = useMessageSelectionStore((state) => state.setSelectionMode);
  const toggleMessageSelection = useMessageSelectionStore(
    (state) => state.toggleMessageSelection,
  );
  const clearSelection = useMessageSelectionStore((state) => state.clearSelection);
  const setTerminalPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);

  const selectedMessages = useMemo(
    () =>
      conversationID
        ? Object.values(selectedMessagesByConversation[conversationID] ?? {})
        : [],
    [conversationID, selectedMessagesByConversation],
  );

  const selectedCount = selectedMessages.length;

  const loadMessages = useCallback(
    async (count: number, loadMore = false, startClientMsgID = "") => {
      if (!conversationID) return;

      setLoading(true);
      try {
        const { data } = await IMSDK.getAdvancedHistoryMessageList({
          count,
          startClientMsgID: loadMore ? startClientMsgID : "",
          conversationID,
          viewType: ViewType.History,
        });

        setHasMore(!data.isEnd);
        setMessages((prevMessages) =>
          loadMore ? [...data.messageList, ...prevMessages] : data.messageList,
        );
      } catch (error) {
        antdMessage.error("Failed to load history messages");
      } finally {
        setLoading(false);
      }
    },
    [conversationID],
  );

  useEffect(() => {
    if (!open || !conversationID) return;
    setMessages([]);
    setHasMore(true);
    void loadMessages(quickCount, false);
  }, [conversationID, loadMessages, open, quickCount]);

  const onQuickLoadChange = (value: number) => {
    setQuickCount(value);
    setMessages([]);
    setHasMore(true);
  };

  const selectVisibleMessages = () => {
    if (!conversationID || messages.length === 0) return;
    messages.forEach((message) => addMessageSelection(conversationID, message));
    antdMessage.success(`Selected ${messages.length} history messages`);
  };

  const toggleHistoryMessage = (message: MessageItem) => {
    if (!conversationID) return;
    setSelectionMode(conversationID, true);
    toggleMessageSelection(conversationID, message);
  };

  const copySelectedMessages = async () => {
    if (selectedMessages.length === 0) return;
    await navigator.clipboard.writeText(formatMessagesAsPlainText(selectedMessages));
    antdMessage.success("Selected history messages copied");
  };

  const createContextFromSelection = () => {
    if (selectedMessages.length === 0) return;
    setTerminalPanelOpen(true);
    emitter.emit("TERMINAL_CONTEXT_ACTION", {
      source: "selectedMessages",
      action: "preview",
    });
  };

  return (
    <Drawer
      title="History"
      open={open}
      onClose={onClose}
      width={460}
      destroyOnClose
      extra={
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#667085]">Recent</span>
          <Segmented
            size="small"
            value={quickCount}
            options={quickLoadOptions.map((value) => ({
              label: String(value),
              value,
            }))}
            onChange={(value) => onQuickLoadChange(Number(value))}
          />
          <Button
            size="small"
            disabled={!hasMore || loading || !conversationID}
            onClick={() => void loadMessages(pageSize, true, messages[0]?.clientMsgID)}
          >
            Load More
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2 py-2">
          <span className="mr-auto text-xs text-[#667085]">
            Selected {selectedCount}
          </span>
          <Button
            size="small"
            disabled={messages.length === 0}
            onClick={selectVisibleMessages}
          >
            Select Visible
          </Button>
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
            onClick={createContextFromSelection}
          >
            Create Context
          </Button>
          <Button
            size="small"
            disabled={!conversationID}
            onClick={() => clearSelection(conversationID)}
          >
            Clear
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-[#e5e7eb]">
          {loading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spin />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No history messages"
              />
            </div>
          ) : (
            <div className="divide-y divide-[#edf0f5]">
              {messages.map((message) => {
                const selected = conversationID
                  ? Boolean(
                      selectedMessagesByConversation[conversationID]?.[
                        message.clientMsgID
                      ],
                    )
                  : false;

                return (
                  <div
                    key={message.clientMsgID}
                    className="flex cursor-pointer gap-3 px-3 py-2 hover:bg-[#f8fafc]"
                    onClick={() => toggleHistoryMessage(message)}
                  >
                    <Checkbox
                      checked={selected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleHistoryMessage(message)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-[#667085]">
                        <span className="max-w-[160px] truncate font-medium text-[#344054]">
                          {getMessageSender(message)}
                        </span>
                        <span>{getMessageTime(message)}</span>
                      </div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[#111827]">
                        {getPlainMessageContent(message)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-center py-3">
                  <Spin size="small" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default MessageHistoryDrawer;
