import { MessageItem as MessageItemType, MessageType } from "@openim/wasm-client-sdk";
import { Checkbox } from "antd";
import clsx from "clsx";
import { FC, memo, useRef } from "react";

import OIMAvatar from "@/components/OIMAvatar";
import { useMessageSelectionStore } from "@/store";
import { formatMessageTime } from "@/utils/imCommon";

import CatchMessageRender from "./CatchMsgRenderer";
import FileMessageRender from "./FileMessageRender";
import MediaMessageRender from "./MediaMessageRender";
import styles from "./message-item.module.scss";
import MessageActionMenu from "./MessageActionMenu";
import MessageItemErrorBoundary from "./MessageItemErrorBoundary";
import MessageSuffix from "./MessageSuffix";
import TextMessageRender from "./TextMessageRender";

export interface IMessageItemProps {
  message: MessageItemType;
  isSender: boolean;
  disabled?: boolean;
  conversationID?: string;
  messageUpdateFlag?: string;
  selectionVisible?: boolean;
}

const components: Record<number, FC<IMessageItemProps>> = {
  [MessageType.TextMessage]: TextMessageRender,
  [MessageType.PictureMessage]: MediaMessageRender,
  [MessageType.FileMessage]: FileMessageRender,
};

const MessageItem: FC<IMessageItemProps> = ({
  message,
  disabled,
  isSender,
  conversationID,
  selectionVisible = true,
}) => {
  const messageWrapRef = useRef<HTMLDivElement>(null);
  const activeSelectionConversationID = useMessageSelectionStore(
    (state) => state.activeConversationID,
  );
  const selectedMessagesByConversation = useMessageSelectionStore(
    (state) => state.selectedMessagesByConversation,
  );
  const toggleMessageSelection = useMessageSelectionStore(
    (state) => state.toggleMessageSelection,
  );
  const MessageRenderComponent = components[message.contentType] || CatchMessageRender;
  const selectionActive =
    Boolean(conversationID) &&
    activeSelectionConversationID === conversationID &&
    selectionVisible;
  const selected = conversationID
    ? Boolean(selectedMessagesByConversation[conversationID]?.[message.clientMsgID])
    : false;

  const toggleSelection = () => {
    if (!conversationID || !selectionActive) return;
    toggleMessageSelection(conversationID, message);
  };

  return (
    <>
      <div
        id={`chat_${message.clientMsgID}`}
        data-testid={`message-item-${message.clientMsgID}`}
        className={clsx(
          "relative flex select-text px-5 py-3",
          selectionActive && "cursor-pointer",
          selected && styles["message-selected-row"],
        )}
        onClick={toggleSelection}
      >
        {selectionActive && (
          <div
            className={styles["message-selection-control"]}
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onChange={toggleSelection}
              data-testid={`message-selection-checkbox-${message.clientMsgID}`}
            />
          </div>
        )}
        <div
          className={clsx(
            styles["message-container"],
            isSender && styles["message-container-sender"],
          )}
        >
          <OIMAvatar
            size={36}
            src={message.senderFaceUrl}
            text={message.senderNickname}
          />

          <div className={styles["message-wrap"]} ref={messageWrapRef}>
            <div className={styles["message-profile"]}>
              <div
                title={message.senderNickname}
                className={clsx(
                  "max-w-[30%] truncate text-[var(--sub-text)]",
                  isSender ? "ml-2" : "mr-2",
                )}
              >
                {message.senderNickname}
              </div>
              <div className="text-[var(--sub-text)]">
                {formatMessageTime(message.sendTime)}
              </div>
            </div>

            <div className={styles["menu-wrap"]}>
              <MessageActionMenu message={message} conversationID={conversationID}>
                <MessageItemErrorBoundary message={message}>
                  <MessageRenderComponent
                    message={message}
                    isSender={isSender}
                    disabled={disabled}
                  />
                </MessageItemErrorBoundary>
              </MessageActionMenu>

              <MessageSuffix
                message={message}
                isSender={isSender}
                disabled={false}
                conversationID={conversationID}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(MessageItem);
