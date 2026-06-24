import { Button, Dropdown, message as antdMessage } from "antd";
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

const menuLabel = (testID: string, label: string) => (
  <span data-testid={testID}>{label}</span>
);

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

  const selectedActionItems = [
    {
      key: "agent",
      label: menuLabel("message-selection-agent-menu", "Agent"),
      children: [
        {
          key: "agent:create-context",
          label: menuLabel(
            "message-selection-agent-create-context",
            "Create Agent Context",
          ),
          disabled: selectedCount === 0,
        },
        {
          key: "agent:copy-prompt",
          label: menuLabel("message-selection-agent-copy-prompt", "Copy Agent Prompt"),
          disabled: selectedCount === 0,
        },
        {
          key: "agent:send-terminal",
          label: menuLabel(
            "message-selection-agent-send-terminal",
            "Send Prompt to Terminal",
          ),
          disabled: selectedCount === 0,
        },
      ],
    },
    {
      key: "forward",
      label: menuLabel("message-selection-forward", "Forward"),
      disabled: true,
    },
    {
      key: "delete",
      label: menuLabel("message-selection-delete", "Delete"),
      disabled: true,
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

  if (!conversationID) return null;

  return (
    <div
      className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md border border-[#d9e2f3] bg-white/95 px-2 py-1 shadow-sm"
      data-testid="message-selection-toolbar"
    >
      <span className="text-xs text-[#667085]" data-testid="message-selection-count">
        Selected {selectedCount} messages
      </span>
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={() => void copySelectedMessages()}
        data-testid="message-selection-copy"
      >
        Copy
      </Button>
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={exportSelectedMessages}
        data-testid="message-selection-export-md"
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
        <Button size="small" data-testid="message-selection-more">
          More
        </Button>
      </Dropdown>
      <Button
        size="small"
        onClick={() => clearSelection(conversationID)}
        data-testid="message-selection-clear"
      >
        Clear
      </Button>
    </div>
  );
};

export default MessageSelectionToolbar;
