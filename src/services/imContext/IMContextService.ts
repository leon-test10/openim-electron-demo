import { MessageItem, MessageType } from "@openim/wasm-client-sdk";
import dayjs from "dayjs";

import { ContextAttachment, extractMessageAttachments } from "./attachments";
import { ContextBundle, ContextManifest, ContextSource } from "./types";

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

const getSourceLabel = (source: ContextSource) => {
  const conversation = sanitizeFileSegment(source.conversationID);

  if (source.kind === "recentMessages") {
    return `${conversation}-recent-${source.limit}`;
  }

  return `${conversation}-${source.kind}`;
};

export const sortMessagesByTime = (messages: MessageItem[]) =>
  [...messages].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));

const formatAttachmentAsMarkdown = (attachment: ContextAttachment) =>
  [
    `- id: ${attachment.attachmentId}`,
    `  kind: ${attachment.kind}`,
    attachment.mime ? `  mime: ${attachment.mime}` : undefined,
    `  name: ${attachment.displayName}`,
    `  status: ${attachment.status}`,
    attachment.workspaceRelativePath
      ? `  path: ${attachment.workspaceRelativePath}`
      : undefined,
    `  logicalUri: ${attachment.logicalUri}`,
    attachment.sourceUrl ? `  sourceUrl: ${attachment.sourceUrl}` : undefined,
    attachment.size ? `  size: ${attachment.size}` : undefined,
    attachment.sha256 ? `  sha256: ${attachment.sha256}` : undefined,
    attachment.error ? `  error: ${attachment.error}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const formatMessageAsContextMarkdown = (
  message: MessageItem,
  index: number,
  attachments: ContextAttachment[] = [],
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
  } else if (message.contentType === MessageType.PictureMessage) {
    const url =
      message.pictureElem?.sourcePicture?.url ??
      message.pictureElem?.bigPicture?.url ??
      message.pictureElem?.snapshotPicture?.url;
    lines.push(url ? `[image] ${url}` : "[image attachment]");
  } else if (message.fileElem) {
    lines.push(
      `[file] ${message.fileElem.fileName ?? "unnamed"} ${
        message.fileElem.sourceUrl ?? ""
      }`.trim(),
    );
  } else if (message.contentType === MessageType.VideoMessage) {
    lines.push("[video attachment]");
  } else if (message.contentType === MessageType.VoiceMessage) {
    lines.push("[audio attachment]");
  } else {
    lines.push(`[unsupported message type: ${message.contentType}]`);
  }

  if (attachments.length > 0) {
    lines.push("", "Attachments:", ...attachments.map(formatAttachmentAsMarkdown));
  }

  return lines.join("\n");
};

export const createContextPrompt = (
  bundle: Pick<ContextBundle, "files" | "stats" | "attachments">,
) => {
  const lines = [
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
  ];

  if (bundle.stats.exportedAttachmentCount > 0) {
    const firstExported = bundle.attachments.find(
      (attachment) => attachment.status === "exported",
    );
    const attachmentRoot =
      firstExported?.workspaceRelativePath?.split("/").slice(0, 2).join("/") ??
      "attachments/";

    lines.push(
      "This context contains local attachment files under:",
      "",
      attachmentRoot,
      "",
      "Use workspace-relative paths when reading files.",
      "",
    );
  } else if (bundle.stats.attachmentCount > 0) {
    lines.push(
      "Some attachments could not be exported. Check the manifest for status and source metadata.",
      "",
    );
  }

  lines.push("Use this context to answer the user's latest request.");

  return lines.join("\n");
};

const serializeAttachmentForManifest = (attachment: ContextAttachment) => {
  const { workspaceAbsolutePath, ...manifestAttachment } = attachment;
  return manifestAttachment;
};

const buildBundleArtifacts = ({
  id,
  createdAt,
  workspacePath,
  source,
  messages,
  attachments,
  files,
}: {
  id: string;
  createdAt: number;
  workspacePath: string;
  source: ContextSource;
  messages: MessageItem[];
  attachments: ContextAttachment[];
  files: ContextBundle["files"];
}): Pick<
  ContextBundle,
  "attachments" | "manifest" | "markdown" | "promptText" | "stats"
> => {
  const attachmentByMessage = new Map<string, ContextAttachment[]>();

  attachments.forEach((attachment) => {
    const current = attachmentByMessage.get(attachment.source.clientMsgID) ?? [];
    current.push(attachment);
    attachmentByMessage.set(attachment.source.clientMsgID, current);
  });

  const messageMarkdown = messages.map((message, index) =>
    formatMessageAsContextMarkdown(
      message,
      index,
      attachmentByMessage.get(message.clientMsgID) ?? [],
    ),
  );
  const sourceMeta =
    source.kind === "recentMessages"
      ? [`Limit: ${source.limit}`]
      : [
          `Message IDs: ${source.messageIDs.join(", ")}`,
          source.keyword ? `Keyword: ${source.keyword}` : undefined,
        ].filter(Boolean);

  const markdown = [
    "# OpenIM Context Bundle",
    "",
    `Bundle: ${id}`,
    `Created At: ${dayjs(createdAt).format("YYYY-MM-DD HH:mm:ss")}`,
    `Workspace: ${workspacePath}`,
    `Source: ${source.kind}`,
    `Conversation: ${source.conversationID}`,
    ...sourceMeta.map((item) => String(item)),
    "",
    "## Messages",
    "",
    ...messageMarkdown.flatMap((item) => [item, ""]),
  ].join("\n");

  const exportedAttachmentCount = attachments.filter(
    (attachment) => attachment.status === "exported",
  ).length;
  const failedAttachmentCount = attachments.filter(
    (attachment) => attachment.status === "failed",
  ).length;
  const unsupportedAttachmentCount = attachments.filter(
    (attachment) => attachment.status === "unsupported",
  ).length;
  const stats = {
    messageCount: messages.length,
    attachmentCount: attachments.length,
    exportedAttachmentCount,
    failedAttachmentCount,
    unsupportedAttachmentCount,
    approxChars: markdown.length,
  };
  const manifestAttachments = attachments.map(serializeAttachmentForManifest);
  const manifest: ContextManifest = {
    id,
    createdAt,
    workspacePath,
    source,
    messages: messages.map((message) => ({
      clientMsgID: message.clientMsgID,
      contentType: message.contentType,
      sendTime: message.sendTime,
      senderNickname: message.senderNickname,
      attachments: (attachmentByMessage.get(message.clientMsgID) ?? []).map(
        (attachment) => attachment.attachmentId,
      ),
    })),
    attachments: manifestAttachments,
    stats,
  };
  const promptText = createContextPrompt({
    files,
    stats,
    attachments,
  });

  return {
    attachments,
    manifest,
    markdown,
    promptText,
    stats,
  };
};

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
  const id = `bundle_${timestamp}_${getSourceLabel(source)}`;
  const markdownPath = `context/${id}.md`;
  const manifestPath = `context/${id}.manifest.json`;
  const files = {
    markdownPath,
    manifestPath,
  };
  const attachments = orderedMessages.flatMap((message) =>
    extractMessageAttachments({
      message,
      conversationID: source.conversationID,
      bundleId: id,
    }),
  );
  const artifacts = buildBundleArtifacts({
    id,
    createdAt,
    workspacePath,
    source,
    messages: orderedMessages,
    attachments,
    files,
  });
  const bundleDraft = {
    id,
    createdAt,
    workspacePath,
    source,
    files,
    messages: orderedMessages,
  };

  return {
    ...bundleDraft,
    ...artifacts,
  };
};

export const withContextAttachments = (
  bundle: ContextBundle,
  attachments: ContextAttachment[],
): ContextBundle => {
  const artifacts = buildBundleArtifacts({
    id: bundle.id,
    createdAt: bundle.createdAt,
    workspacePath: bundle.workspacePath,
    source: bundle.source,
    messages: bundle.messages,
    attachments,
    files: bundle.files,
  });

  return {
    ...bundle,
    ...artifacts,
  };
};

export const IMContextService = {
  createContextBundle,
  createContextPrompt,
  formatMessageAsContextMarkdown,
  sortMessagesByTime,
  withContextAttachments,
};
