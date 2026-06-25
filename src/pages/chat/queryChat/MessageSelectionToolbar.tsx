import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, MenuProps, message as antdMessage } from "antd";
import { FC, useMemo } from "react";

import { useMessageSelectionStore, useTerminalDockStore } from "@/store";
import emitter from "@/utils/events";
import {
  formatMessagesAsMarkdown,
  formatMessagesAsPlainText,
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
    <div
      className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 overflow-x-auto rounded-full border border-[#d9e2f3] bg-white/95 px-4 py-3 shadow-[0_12px_32px_rgba(16,24,40,0.16)] backdrop-blur"
      data-testid="message-selection-toolbar"
    >
      <span
        className="shrink-0 text-sm text-[#1677ff]"
        data-testid="message-selection-count"
      >
        Selected {selectedCount} messages
      </span>
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
        disabled
        data-testid="message-selection-forward"
      >
        Forward
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
  );
};

export default MessageSelectionToolbar;
