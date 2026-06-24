import { MessageItem, MessageType, ViewType } from "@openim/wasm-client-sdk";
import {
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  message as antdMessage,
  Segmented,
  Select,
  Spin,
} from "antd";
import type { Dayjs } from "dayjs";
import { FC, useCallback, useEffect, useMemo, useState } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { useMessageSelectionStore, useTerminalDockStore } from "@/store";
import { e2eMessages } from "@/utils/e2eMockData";
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
const { RangePicker } = DatePicker;
type HistoryMode = "history" | "search";
type MessageTypeFilter = "all" | MessageType.TextMessage | MessageType.PictureMessage;
type SearchRange = [Dayjs | null, Dayjs | null] | null;

const flattenSearchResults = (data: unknown): MessageItem[] => {
  if (Array.isArray(data)) {
    return data as MessageItem[];
  }

  const result = data as {
    searchResultItems?: Array<{ messageList?: MessageItem[] }>;
    findResultItems?: Array<{ messageList?: MessageItem[] }>;
  };
  return [...(result.searchResultItems ?? []), ...(result.findResultItems ?? [])]
    .flatMap((item) => item.messageList ?? [])
    .filter(Boolean);
};

const matchesRange = (message: MessageItem, range: SearchRange) => {
  const [start, end] = range ?? [];
  if (!start && !end) return true;

  const sendTime = message.sendTime ?? 0;
  if (start && sendTime < start.startOf("day").valueOf()) return false;
  if (end && sendTime > end.endOf("day").valueOf()) return false;
  return true;
};

const matchesType = (message: MessageItem, type: MessageTypeFilter) =>
  type === "all" || message.contentType === type;

const recentOptionLabel = (value: number) => (
  <span data-testid={`history-recent-${value}`}>{value}</span>
);

const isE2EMode =
  typeof window !== "undefined" && window.location.hash.includes("/e2e-harness");

const MessageHistoryDrawer: FC<MessageHistoryDrawerProps> = ({
  conversationID,
  open,
  onClose,
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [historyMessages, setHistoryMessages] = useState<MessageItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [quickCount, setQuickCount] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<SearchRange>(null);
  const [messageTypeFilter, setMessageTypeFilter] = useState<MessageTypeFilter>("all");
  const [mode, setMode] = useState<HistoryMode>("history");
  const [resultCount, setResultCount] = useState(0);
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
        if (isE2EMode) {
          setHasMore(!loadMore);
          setHistoryMessages((prevMessages) => {
            const nextMessages = loadMore
              ? [...e2eMessages, ...prevMessages]
              : e2eMessages.slice(-count);
            setMessages(nextMessages);
            setResultCount(nextMessages.length);
            return nextMessages;
          });
          setMode("history");
          return;
        }

        const { data } = await IMSDK.getAdvancedHistoryMessageList({
          count,
          startClientMsgID: loadMore ? startClientMsgID : "",
          conversationID,
          viewType: ViewType.History,
        });

        setHasMore(!data.isEnd);
        setHistoryMessages((prevMessages) => {
          const nextMessages = loadMore
            ? [...data.messageList, ...prevMessages]
            : data.messageList;
          setMessages(nextMessages);
          setResultCount(nextMessages.length);
          return nextMessages;
        });
        setMode("history");
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
    setHistoryMessages([]);
    setHasMore(true);
    void loadMessages(quickCount, false);
  }, [conversationID, loadMessages, open, quickCount]);

  const onQuickLoadChange = (value: number) => {
    setQuickCount(value);
    setMessages([]);
    setHistoryMessages([]);
    setHasMore(true);
  };

  const applyLocalFilters = (sourceMessages: MessageItem[]) =>
    sourceMessages.filter(
      (message) =>
        matchesRange(message, range) && matchesType(message, messageTypeFilter),
    );

  const runSearch = async () => {
    if (!conversationID) return;

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      const filteredMessages = applyLocalFilters(historyMessages);
      setMode("history");
      setMessages(filteredMessages);
      setResultCount(filteredMessages.length);
      setHasMore(true);
      return;
    }

    setLoading(true);
    try {
      if (isE2EMode) {
        const searchMessages = applyLocalFilters(e2eMessages).filter((message) =>
          getPlainMessageContent(message)
            .toLowerCase()
            .includes(trimmedKeyword.toLowerCase()),
        );
        setMode("search");
        setMessages(searchMessages);
        setResultCount(searchMessages.length);
        setHasMore(false);
        return;
      }

      const { data } = await IMSDK.searchLocalMessages({
        conversationID,
        keywordList: [trimmedKeyword],
        keywordListMatchType: 0,
        messageTypeList: messageTypeFilter === "all" ? undefined : [messageTypeFilter],
        pageIndex: 1,
        count: 100,
      });
      const searchMessages = applyLocalFilters(flattenSearchResults(data));
      setMode("search");
      setMessages(searchMessages);
      setResultCount(searchMessages.length);
      setHasMore(false);
    } catch (error) {
      antdMessage.error("Failed to search local messages");
    } finally {
      setLoading(false);
    }
  };

  const resetSearch = () => {
    setKeyword("");
    setRange(null);
    setMessageTypeFilter("all");
    setMode("history");
    setMessages(historyMessages);
    setResultCount(historyMessages.length);
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

  const runContextActionFromSelection = (action: "preview" | "copy" | "send") => {
    if (selectedMessages.length === 0) return;
    setTerminalPanelOpen(true);
    emitter.emit("IM_CONTEXT_ACTION", {
      source: {
        kind: mode === "search" ? "searchResults" : "historyMessages",
        conversationID,
        messageIDs: selectedMessages.map((message) => message.clientMsgID),
        keyword: mode === "search" ? keyword.trim() : undefined,
      },
      action,
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
      <div className="flex h-full flex-col gap-3" data-testid="history-drawer">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#667085]">Recent</span>
          <Segmented
            size="small"
            value={quickCount}
            options={quickLoadOptions.map((value) => ({
              label: recentOptionLabel(value),
              value,
            }))}
            onChange={(value) => onQuickLoadChange(Number(value))}
          />
          <Button
            size="small"
            disabled={mode === "search" || !hasMore || loading || !conversationID}
            onClick={() =>
              void loadMessages(pageSize, true, historyMessages[0]?.clientMsgID)
            }
            data-testid="history-load-more"
          >
            Load More
          </Button>
        </div>

        <div className="grid gap-2 rounded-md border border-[#e5e7eb] bg-white p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input.Search
              className="min-w-[180px] flex-1"
              size="small"
              allowClear
              placeholder="Search current conversation"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={() => void runSearch()}
              data-testid="history-search-input"
            />
            <Select<MessageTypeFilter>
              size="small"
              className="w-[128px]"
              value={messageTypeFilter}
              onChange={setMessageTypeFilter}
              options={[
                { label: "All types", value: "all" },
                { label: "Text", value: MessageType.TextMessage },
                { label: "Image", value: MessageType.PictureMessage },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker
              size="small"
              className="min-w-[240px] flex-1"
              value={range}
              onChange={(value) => setRange(value)}
            />
            <Button
              size="small"
              type="primary"
              loading={loading}
              disabled={!conversationID}
              onClick={() => void runSearch()}
              data-testid="history-apply-filter"
            >
              Apply
            </Button>
            <Button
              size="small"
              onClick={resetSearch}
              data-testid="history-reset-filter"
            >
              Reset
            </Button>
          </div>
          <div className="text-xs text-[#667085]">
            {mode === "search" ? "Search results" : "Loaded history"}: {resultCount}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2 py-2">
          <span className="mr-auto text-xs text-[#667085]">
            Selected {selectedCount}
          </span>
          <Button
            size="small"
            disabled={messages.length === 0}
            onClick={selectVisibleMessages}
            data-testid="history-select-visible"
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
            onClick={() => runContextActionFromSelection("preview")}
            data-testid="history-create-context"
          >
            Preview Selected Context
          </Button>
          <Button
            size="small"
            disabled={selectedCount === 0}
            onClick={() => runContextActionFromSelection("copy")}
            data-testid="history-copy-prompt"
          >
            Copy Selected Prompt
          </Button>
          <Button
            size="small"
            disabled={selectedCount === 0}
            onClick={() => runContextActionFromSelection("send")}
            data-testid="history-send-terminal"
          >
            Send Selected to Terminal
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
