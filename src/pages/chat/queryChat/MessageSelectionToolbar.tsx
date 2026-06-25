import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, MenuProps, message as antdMessage } from "antd";
import { FC, useMemo } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { openMessageForwardChooser } from "@/services/messageForward";
import { useMessageSelectionStore, useTerminalDockStore } from "@/store";
import emitter from "@/utils/events";
import {
  formatMessagesAsMarkdown,
  formatMessagesAsPlainText,
  sortSelectedMessages,
} from "@/utils/messageSelectionFormat";

interface MessageSelectionToolbarProps {
  conversationID?: string;
}

const MessageSelectionToolbar: FC<MessageSelectionToolbarProps> = ({
  conversationID,
}) => {
  const selectedMessagesByConversation = useMessageSelectionStore(
    (state) => state.selectedMessagesByConversation,
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

  const runSelectedContextAction = (action: "preview" | "copy" | "send") => {
    setTerminalPanelOpen(true);
    emitter.emit("IM_CONTEXT_ACTION", {
      source: {
        kind: "selectedMessages",
        conversationID,
        messageIDs: selectedMessages.map((item) => item.clientMsgID),
      },
      action,
    });
  };

  const copySelectedMessages = async () => {
    if (selectedMessages.length === 0) return;
    await navigator.clipboard.writeText(formatMessagesAsPlainText(selectedMessages));
    antdMessage.success("Selected messages copied");
  };

  const deleteSelectedMessages = async () => {
    if (!conversationID || selectedMessages.length === 0) return;

    const messages = sortSelectedMessages(selectedMessages);
    const results = await Promise.allSettled(
      messages.map((message) =>
        IMSDK.deleteMessageFromLocalStorage({
          conversationID,
          clientMsgID: message.clientMsgID,
        }),
      ),
    );

    emitter.emit("REMOVE_MESSAGES", {
      conversationID,
      clientMsgIDs: messages.map((message) => message.clientMsgID),
    });
    clearSelection(conversationID);

    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount > 0) {
      antdMessage.warning(`Deleted locally with ${failedCount} failures`);
      return;
    }

    antdMessage.success("Selected messages deleted");
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

  const advancedItems: MenuProps["items"] = [
    {
      key: "advanced",
      label: (
        <span data-testid="message-selection-advanced-menu">Advanced / Debug</span>
      ),
      children: [
        {
          key: "advanced:preview",
          label: (
            <span data-testid="message-selection-preview">
              Preview Selected Context
            </span>
          ),
        },
        {
          key: "advanced:copy-prompt",
          label: (
            <span data-testid="message-selection-copy-prompt">
              Copy Selected Prompt
            </span>
          ),
        },
        {
          key: "advanced:export-md",
          label: <span data-testid="message-selection-export-md">Export MD</span>,
        },
      ],
    },
  ];

  const onMoreMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "advanced:preview") {
      runSelectedContextAction("preview");
      return;
    }

    if (key === "advanced:copy-prompt") {
      runSelectedContextAction("copy");
      return;
    }

    if (key === "advanced:export-md") {
      exportSelectedMessages();
    }
  };

  if (!conversationID) return null;

  return (
    <div className="absolute bottom-4 left-1/2 z-20 w-[calc(100%-32px)] max-w-[920px] -translate-x-1/2">
      <div
        className="bg-white/96 flex flex-wrap items-center justify-center gap-2 rounded-[32px] border border-[#d9e2f3] px-4 py-3 shadow-[0_12px_32px_rgba(16,24,40,0.16)] backdrop-blur"
        data-testid="message-selection-toolbar"
      >
        <div className="mr-2 flex min-w-0 flex-col">
          <span className="text-base font-medium text-[#1677ff]">选择以下信息</span>
          <span
            className="text-xs text-[#667085]"
            data-testid="message-selection-count"
          >
            Selected {selectedCount} messages
          </span>
        </div>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount === 0}
          onClick={() =>
            openMessageForwardChooser(conversationID, selectedMessages, "single")
          }
          data-testid="message-selection-forward-single"
        >
          Forward
        </Button>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount < 2}
          onClick={() =>
            openMessageForwardChooser(conversationID, selectedMessages, "merged")
          }
          data-testid="message-selection-forward-merged"
        >
          Merge Forward
        </Button>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount === 0}
          onClick={() => void copySelectedMessages()}
          data-testid="message-selection-copy"
        >
          Copy
        </Button>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount === 0}
          onClick={() => void deleteSelectedMessages()}
          data-testid="message-selection-delete"
        >
          Delete
        </Button>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount === 0}
          onClick={() => runSelectedContextAction("send")}
          data-testid="message-selection-send"
        >
          Send to Agent
        </Button>
        <Dropdown
          menu={{
            items: advancedItems,
            onClick: onMoreMenuClick,
            triggerSubMenuAction: "click",
          }}
          trigger={["click"]}
        >
          <Button
            size="small"
            className="shrink-0"
            disabled={selectedCount === 0}
            onClick={(event) => event.stopPropagation()}
            data-testid="message-selection-more"
          >
            More
            <DownOutlined />
          </Button>
        </Dropdown>
        <Button
          size="small"
          className="shrink-0"
          disabled={selectedCount === 0}
          onClick={() => clearSelection(conversationID)}
          data-testid="message-selection-clear"
        >
          Clear
        </Button>
      </div>
    </div>
  );
};

export default MessageSelectionToolbar;
