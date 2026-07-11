import { MoreOutlined } from "@ant-design/icons";
import { MessageItem as MessageItemType, MessageType } from "@openim/wasm-client-sdk";
import { Button, Dropdown, MenuProps, message as antdMessage } from "antd";
import { FC, PropsWithChildren, useState } from "react";

import { openMessageForwardChooser } from "@/services/messageForward";
import { useAgentSessionStore, useMessageSelectionStore } from "@/store";
import emitter from "@/utils/events";
import {
  getLocalFileForMessage,
  type LocalFileCacheEntry,
  recordLocalFileForMessage,
} from "@/utils/localFileCache";
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
  const selectOnlyMessage = useMessageSelectionStore(
    (state) => state.selectOnlyMessage,
  );
  const isTextMessage = message.contentType === MessageType.TextMessage;
  const isPictureMessage = message.contentType === MessageType.PictureMessage;
  const isFileMessage = message.contentType === MessageType.FileMessage;
  const canCopyText = isTextMessage;
  const [localFileEntry, setLocalFileEntry] = useState<LocalFileCacheEntry | undefined>(
    () => getLocalFileForMessage(message.clientMsgID),
  );
  const previewUrl =
    message.pictureElem?.sourcePicture?.url ??
    message.pictureElem?.bigPicture?.url ??
    message.pictureElem?.snapshotPicture?.url ??
    message.fileElem?.sourceUrl;
  const downloadFileName =
    message.fileElem?.fileName ??
    `${message.clientMsgID}${isPictureMessage ? ".png" : ""}`;

  const downloadFileToLocal = async (saveAs = false) => {
    if (!previewUrl) return undefined;
    if (!window.electronAPI || isPictureMessage) {
      const link = document.createElement("a");
      link.href = previewUrl;
      link.download = downloadFileName;
      link.click();
      return undefined;
    }

    const nativePath = await window.electronAPI.ipcInvoke<string>(
      "file:downloadToLocal",
      {
        sourceUrl: previewUrl,
        fileName: downloadFileName,
        saveAs,
      },
    );
    recordLocalFileForMessage(message.clientMsgID, downloadFileName, nativePath);
    setLocalFileEntry(getLocalFileForMessage(message.clientMsgID));
    return nativePath;
  };

  const runSingleMessageContextAction = (action: "preview" | "copy" | "send") => {
    if (!conversationID) return;

    selectOnlyMessage(conversationID, message);
    void useAgentSessionStore.getState().setPanelState({ agentPanelOpen: true });
    emitter.emit("IM_CONTEXT_ACTION", {
      source: {
        kind: "selectedMessages",
        conversationID,
        messageIDs: [message.clientMsgID],
      },
      action,
    });
  };

  const menuItems: MenuProps["items"] = [];

  if (isTextMessage) {
    menuItems.push({
      key: "reply",
      label: menuLabel("message-action-reply", "Reply"),
    });
    menuItems.push({
      key: "copy",
      label: menuLabel("message-action-copy", "Copy"),
      disabled: !canCopyText,
    });
  }

  if (previewUrl) {
    menuItems.push({
      key: "view",
      label: menuLabel("message-action-view", "View"),
    });
    menuItems.push({
      key: "download",
      label: menuLabel("message-action-download", "Download"),
    });
    menuItems.push({
      key: "save-as",
      label: menuLabel("message-action-save-as", "Save as"),
    });
    menuItems.push({
      key: "copy-file-name",
      label: menuLabel("message-action-copy-file-name", "Copy file name"),
    });
  }

  if (localFileEntry?.nativePath) {
    menuItems.push({
      key: "show-in-folder",
      label: menuLabel("message-action-show-in-folder", "Show in folder"),
    });
  }

  menuItems.push(
    {
      key: "forward",
      label: menuLabel("message-action-forward", "Forward"),
    },
    {
      key: "favorite",
      label: menuLabel("message-action-favorite", "Favorite"),
      disabled: true,
    },
    {
      key: "select",
      label: menuLabel("message-action-select", "Multi-select"),
      disabled: !conversationID,
    },
  );

  if (isTextMessage) {
    menuItems.push({
      key: "translate",
      label: menuLabel("message-action-translate", "Translate"),
      disabled: true,
    });
  }

  menuItems.push(
    {
      type: "divider",
    },
    {
      key: "delete",
      label: menuLabel("message-action-delete", "Delete"),
      disabled: true,
    },
  );

  if (isTextMessage) {
    menuItems.push({
      key: "recall",
      label: menuLabel("message-action-recall", "Recall"),
      disabled: true,
    });
  }

  menuItems.push(
    {
      type: "divider",
    },
    {
      key: "more",
      label: menuLabel("message-action-more-menu", "More"),
      disabled: !conversationID,
      children: [
        {
          key: "agent:send",
          label: menuLabel("message-action-send-to-agent", "Send to Agent"),
        },
        {
          key: "agent:advanced",
          label: menuLabel("message-action-advanced-menu", "Advanced / Debug"),
          children: [
            {
              key: "agent:preview",
              label: menuLabel(
                "message-action-preview-context",
                "Preview Selected Context",
              ),
            },
            {
              key: "agent:copy-prompt",
              label: menuLabel("message-action-copy-prompt", "Copy Selected Prompt"),
            },
          ],
        },
      ],
    },
  );

  const onMenuClick = async ({ key }: { key: string }) => {
    if (!conversationID && !["copy", "view", "download"].includes(key)) return;

    if (key === "copy") {
      await navigator.clipboard.writeText(getPlainMessageContent(message));
      antdMessage.success("Message copied");
      return;
    }

    if (key === "reply") {
      emitter.emit("APPEND_CHAT_INPUT", formatMessageAsQuoteText(message));
      antdMessage.success("Reply added to draft");
      return;
    }

    if (key === "view") {
      if (isFileMessage && window.electronAPI) {
        const nativePath = localFileEntry?.nativePath ?? (await downloadFileToLocal());
        if (nativePath) {
          const error = await window.electronAPI.ipcInvoke<string>(
            "file:openPath",
            nativePath,
          );
          if (error) antdMessage.error(error);
        }
      } else if (previewUrl) {
        window.open(previewUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    if (key === "download") {
      await downloadFileToLocal();
      return;
    }

    if (key === "save-as") {
      await downloadFileToLocal(true);
      return;
    }

    if (key === "copy-file-name") {
      await navigator.clipboard.writeText(downloadFileName);
      antdMessage.success("File name copied");
      return;
    }

    if (key === "show-in-folder") {
      if (localFileEntry?.nativePath) {
        await window.electronAPI?.ipcInvoke(
          "file:showItemInFolder",
          localFileEntry.nativePath,
        );
      }
      return;
    }

    if (!conversationID) return;

    if (key === "forward") {
      openMessageForwardChooser(conversationID, [message], "single");
      return;
    }

    if (key === "select") {
      selectOnlyMessage(conversationID, message);
      return;
    }

    if (key === "agent:preview") {
      runSingleMessageContextAction("preview");
      return;
    }

    if (key === "agent:copy-prompt") {
      runSingleMessageContextAction("copy");
      return;
    }

    if (key === "agent:send") {
      runSingleMessageContextAction("send");
    }
  };

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: (info) => {
          void onMenuClick(info);
        },
        triggerSubMenuAction: "click",
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
            triggerSubMenuAction: "click",
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
