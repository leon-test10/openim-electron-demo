import { MoreOutlined } from "@ant-design/icons";
import { MessageItem as MessageItemType, MessageType } from "@openim/wasm-client-sdk";
import { Button, Dropdown, message as antdMessage } from "antd";
import { FC, PropsWithChildren } from "react";

import { useMessageSelectionStore, useTerminalDockStore } from "@/store";
import emitter from "@/utils/events";
import {
  formatMessageAsQuoteText,
  getPlainMessageContent,
} from "@/utils/messageSelectionFormat";

import styles from "./message-item.module.scss";

interface MessageActionMenuProps extends PropsWithChildren {
  message: MessageItemType;
  conversationID?: string;
}

const menuLabel = (testID: string, label: string) => (
  <span data-testid={testID}>{label}</span>
);

const MessageActionMenu: FC<MessageActionMenuProps> = ({
  message,
  conversationID,
  children,
}) => {
  const setSelectionMode = useMessageSelectionStore((state) => state.setSelectionMode);
  const addMessageSelection = useMessageSelectionStore(
    (state) => state.addMessageSelection,
  );
  const selectOnlyMessage = useMessageSelectionStore(
    (state) => state.selectOnlyMessage,
  );
  const setTerminalPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);
  const canCopyText = message.contentType === MessageType.TextMessage;

  const createSingleMessageAgentContext = (action: "preview" | "copy" | "send") => {
    if (!conversationID) return;

    selectOnlyMessage(conversationID, message);
    setTerminalPanelOpen(true);
    emitter.emit("IM_CONTEXT_ACTION", {
      source: {
        kind: "selectedMessages",
        conversationID,
        messageIDs: [message.clientMsgID],
      },
      action,
    });
  };

  const menuItems = [
    {
      key: "copy",
      label: menuLabel("message-action-copy", "Copy"),
      disabled: !canCopyText,
    },
    {
      key: "quote",
      label: menuLabel("message-action-quote", "Quote"),
    },
    {
      key: "forward",
      label: menuLabel("message-action-forward", "Forward"),
      disabled: true,
    },
    {
      key: "select",
      label: menuLabel("message-action-select", "Select"),
      disabled: !conversationID,
    },
    {
      key: "add-selection",
      label: menuLabel("message-action-add-selection", "Add to Selection"),
      disabled: !conversationID,
    },
    {
      type: "divider" as const,
    },
    {
      key: "delete",
      label: menuLabel("message-action-delete", "Delete"),
      disabled: true,
    },
    {
      key: "recall",
      label: menuLabel("message-action-recall", "Recall"),
      disabled: true,
    },
    {
      type: "divider" as const,
    },
    {
      key: "agent",
      label: menuLabel("message-action-agent-menu", "Agent"),
      disabled: !conversationID,
      children: [
        {
          key: "agent:create-context",
          label: menuLabel(
            "message-action-agent-create-context",
            "Create Agent Context",
          ),
        },
        {
          key: "agent:copy-prompt",
          label: menuLabel("message-action-agent-copy-prompt", "Copy Agent Prompt"),
        },
        {
          key: "agent:send-terminal",
          label: menuLabel(
            "message-action-agent-send-terminal",
            "Send Prompt to Terminal",
          ),
        },
      ],
    },
  ];

  const onMenuClick = async ({ key }: { key: string }) => {
    if (!conversationID && key !== "copy") return;

    if (key === "copy") {
      await navigator.clipboard.writeText(getPlainMessageContent(message));
      antdMessage.success("Message copied");
      return;
    }

    if (key === "quote") {
      emitter.emit("APPEND_CHAT_INPUT", formatMessageAsQuoteText(message));
      antdMessage.success("Quote added to draft");
      return;
    }

    if (!conversationID) return;

    if (key === "select") {
      selectOnlyMessage(conversationID, message);
      return;
    }

    if (key === "add-selection") {
      setSelectionMode(conversationID, true);
      addMessageSelection(conversationID, message);
      return;
    }

    if (key === "agent:create-context") {
      createSingleMessageAgentContext("preview");
    }
    if (key === "agent:copy-prompt") {
      createSingleMessageAgentContext("copy");
    }
    if (key === "agent:send-terminal") {
      createSingleMessageAgentContext("send");
    }
  };

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: (info) => {
          void onMenuClick(info);
        },
      }}
      trigger={["contextMenu"]}
    >
      <div
        className={styles["message-action-host"]}
        data-testid={`message-action-host-${message.clientMsgID}`}
      >
        {children}
        <Dropdown
          menu={{
            items: menuItems,
            onClick: (info) => {
              void onMenuClick(info);
            },
          }}
          trigger={["click"]}
        >
          <Button
            size="small"
            type="text"
            className={styles["message-action-trigger"]}
            icon={<MoreOutlined rev={undefined} />}
            onClick={(event) => event.stopPropagation()}
            data-testid={`message-action-menu-trigger-${message.clientMsgID}`}
          />
        </Dropdown>
      </div>
    </Dropdown>
  );
};

export default MessageActionMenu;
