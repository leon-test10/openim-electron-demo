import { Button, message as antdMessage } from "antd";
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

  if (!conversationID) return null;

  return (
    <div
      className="sticky top-3 z-10 mx-4 mt-3 flex w-fit flex-wrap items-center gap-2 rounded-md border border-[#d9e2f3] bg-white/95 px-2 py-1 shadow-sm"
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
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={() => runSelectedContextAction("preview")}
        data-testid="message-selection-preview"
      >
        Preview Selected Context
      </Button>
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={() => runSelectedContextAction("copy")}
        data-testid="message-selection-copy-prompt"
      >
        Copy Selected Prompt
      </Button>
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={() => runSelectedContextAction("send")}
        data-testid="message-selection-send"
      >
        Send Selected to Terminal
      </Button>
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
