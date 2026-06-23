import { MessageItem, MessageType } from "@openim/wasm-client-sdk";
import dayjs from "dayjs";

export type ContextSource =
  | {
      kind: "recentMessages";
      conversationID: string;
      limit: number;
    }
  | {
      kind: "selectedMessages";
      conversationID: string;
      messageIDs: string[];
    };

export interface ContextBundle {
  id: string;
  createdAt: number;
  workspacePath: string;
  source: ContextSource;
  files: {
    markdownPath: string;
    manifestPath: string;
  };
  promptText: string;
  markdown: string;
  manifest: {
    id: string;
    createdAt: number;
    workspacePath: string;
    source: ContextSource;
    messages: Array<{
      clientMsgID: string;
      contentType: number;
      sendTime?: number;
      senderNickname?: string;
      attachment?: Record<string, unknown>;
    }>;
    stats: ContextBundle["stats"];
  };
  stats: {
    messageCount: number;
    attachmentCount: number;
    approxChars: number;
  };
}

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<\/p><p>/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 96);

const getSender = (message: MessageItem) =>
  message.senderNickname || message.senderFaceUrl || message.sendID || "unknown";

const formatTime = (sendTime?: number) =>
  sendTime ? dayjs(sendTime).format("YYYY-MM-DD HH:mm:ss") : "unknown";

export const sortMessagesByTime = (messages: MessageItem[]) =>
  [...messages].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));

export const formatMessageAsContextMarkdown = (
  message: MessageItem,
  index: number,
) => {
  const lines = [
    `### Message ${index + 1}`,
    `- Sender: ${getSender(message)}`,
    `- Time: ${formatTime(message.sendTime)}`,
    `- Type: ${message.contentType}`,
    `- ClientMsgID: ${message.clientMsgID}`,
    ``,
    `Content:`,
  ];

  if (message.contentType === MessageType.TextMessage) {
    lines.push(stripHtml(message.textElem?.content) || "[empty text]");
    return lines.join("\n");
  }

  if (message.contentType === MessageType.PictureMessage) {
    const url =
      message.pictureElem?.sourcePicture?.url ??
      message.pictureElem?.bigPicture?.url ??
      message.pictureElem?.snapshotPicture?.url;
    lines.push(url ? `[image] ${url}` : "[image attachment]");
    return lines.join("\n");
  }

  if (message.fileElem) {
    lines.push(
      `[file] ${message.fileElem.fileName ?? "unnamed"} ${
        message.fileElem.sourceUrl ?? ""
      }`.trim(),
    );
    return lines.join("\n");
  }

  lines.push(`[unsupported message type: ${message.contentType}]`);
  return lines.join("\n");
};

const getAttachmentMeta = (message: MessageItem): Record<string, unknown> | undefined => {
  if (message.contentType === MessageType.PictureMessage) {
    return {
      kind: "image",
      sourceUrl: message.pictureElem?.sourcePicture?.url,
      snapshotUrl: message.pictureElem?.snapshotPicture?.url,
      width: message.pictureElem?.sourcePicture?.width,
      height: message.pictureElem?.sourcePicture?.height,
    };
  }

  if (message.fileElem) {
    return {
      kind: "file",
      fileName: message.fileElem.fileName,
      sourceUrl: message.fileElem.sourceUrl,
      fileSize: message.fileElem.fileSize,
    };
  }

  if (message.contentType !== MessageType.TextMessage) {
    return {
      kind: "unsupported",
      contentType: message.contentType,
    };
  }

  return undefined;
};

export const createContextPrompt = (bundle: Pick<ContextBundle, "files">) =>
  [
    "You are running inside a terminal agent session.",
    "",
    "Read this OpenIM context file first:",
    "",
    bundle.files.markdownPath,
    "",
    "If attachments or unsupported messages are referenced, inspect this manifest:",
    "",
    bundle.files.manifestPath,
    "",
    "Use this context to answer the user's latest request.",
  ].join("\n");

export const createContextBundle = ({
  workspacePath,
  source,
  messages,
}: {
  workspacePath: string;
  source: ContextSource;
  messages: MessageItem[];
}): ContextBundle => {
  const orderedMessages = sortMessagesByTime(messages);
  const createdAt = Date.now();
  const timestamp = dayjs(createdAt).format("YYYYMMDD-HHmmss");
  const sourceLabel =
    source.kind === "recentMessages"
      ? `${sanitizeFileSegment(source.conversationID)}-recent-${source.limit}`
      : `${sanitizeFileSegment(source.conversationID)}-selected`;
  const id = `bundle_${timestamp}_${sourceLabel}`;
  const markdownPath = `context/${id}.md`;
  const manifestPath = `context/${id}.manifest.json`;
  const messageMarkdown = orderedMessages.map(formatMessageAsContextMarkdown);
  const attachmentMessages = orderedMessages
    .map((message) => ({
      clientMsgID: message.clientMsgID,
      contentType: message.contentType,
      sendTime: message.sendTime,
      senderNickname: message.senderNickname,
      attachment: getAttachmentMeta(message),
    }))
    .filter((item) => item.attachment);

  const markdown = [
    "# OpenIM Context Bundle",
    "",
    `Bundle: ${id}`,
    `Created At: ${dayjs(createdAt).format("YYYY-MM-DD HH:mm:ss")}`,
    `Workspace: ${workspacePath}`,
    `Source: ${source.kind}`,
    `Conversation: ${source.conversationID}`,
    "",
    "## Messages",
    "",
    ...messageMarkdown.flatMap((item) => [item, ""]),
  ].join("\n");

  const stats = {
    messageCount: orderedMessages.length,
    attachmentCount: attachmentMessages.length,
    approxChars: markdown.length,
  };
  const bundleDraft = {
    id,
    createdAt,
    workspacePath,
    source,
    files: {
      markdownPath,
      manifestPath,
    },
    stats,
  };
  const promptText = createContextPrompt(bundleDraft);

  return {
    ...bundleDraft,
    promptText,
    markdown,
    manifest: {
      ...bundleDraft,
      messages: attachmentMessages,
    },
  };
};
