import { MessageItem, MessageType } from "@openim/wasm-client-sdk";
import dayjs from "dayjs";

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<\/p><p>/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

export const getMessageSender = (message: MessageItem) =>
  message.senderNickname || message.sendID || "unknown";

export const getMessageTime = (message: MessageItem) =>
  message.sendTime ? dayjs(message.sendTime).format("YYYY-MM-DD HH:mm:ss") : "unknown";

export const sortSelectedMessages = (messages: MessageItem[]) =>
  [...messages].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));

export const getPlainMessageContent = (message: MessageItem) => {
  if (message.contentType === MessageType.TextMessage) {
    return stripHtml(message.textElem?.content) || "[empty text]";
  }

  if (message.contentType === MessageType.PictureMessage) {
    const url =
      message.pictureElem?.sourcePicture?.url ??
      message.pictureElem?.bigPicture?.url ??
      message.pictureElem?.snapshotPicture?.url;
    return url ? `[image] ${url}` : "[image attachment]";
  }

  if (message.fileElem) {
    return `[file] ${message.fileElem.fileName ?? "unnamed"}`;
  }

  return `[unsupported message type: ${message.contentType}]`;
};

export const formatMessagesAsPlainText = (messages: MessageItem[]) =>
  sortSelectedMessages(messages)
    .map(
      (message) =>
        `[${getMessageTime(message)}] ${getMessageSender(
          message,
        )}:\n${getPlainMessageContent(message)}`,
    )
    .join("\n\n");

export const formatMessageAsQuoteText = (message: MessageItem) =>
  [
    `> Quote from ${getMessageSender(message)} at ${getMessageTime(message)}:`,
    `> ${getPlainMessageContent(message).replaceAll("\n", "\n> ")}`,
    "",
  ].join("\n");

export const formatMessagesAsMarkdown = (messages: MessageItem[]) =>
  [
    "# Selected Messages",
    "",
    ...sortSelectedMessages(messages).flatMap((message, index) => [
      `## Message ${index + 1}`,
      "",
      `- Sender: ${getMessageSender(message)}`,
      `- Time: ${getMessageTime(message)}`,
      `- Type: ${message.contentType}`,
      `- ClientMsgID: ${message.clientMsgID}`,
      "",
      getPlainMessageContent(message),
      "",
    ]),
  ].join("\n");
