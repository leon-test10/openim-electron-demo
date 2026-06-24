import { MessageItem, MessageType } from "@openim/wasm-client-sdk";
import dayjs from "dayjs";

import { ContextAttachment, extractMessageAttachments } from "./attachments";
import {
  ContextAttachmentStatusSummary,
  ContextBundle,
  ContextBundleStatus,
  ContextManifest,
  ContextSource,
  ContextSourceSummary,
} from "./types";

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

const formatTimeRange = (startTime?: number, endTime?: number) => {
  if (!startTime && !endTime) return "unknown";
  if (startTime && endTime) {
    return `${formatTime(startTime)} -> ${formatTime(endTime)}`;
  }
  return formatTime(startTime ?? endTime);
};

const getSourceLabel = (source: ContextSource) => {
  const conversation = sanitizeFileSegment(source.conversationID);

  if (source.kind === "recentMessages") {
    return `${conversation}-recent-${source.limit}`;
  }

  if (source.kind === "botTrigger") {
    return `${conversation}-botTrigger-${sanitizeFileSegment(source.triggerMessageID)}`;
  }

  return `${conversation}-${source.kind}`;
};

export const sortMessagesByTime = (messages: MessageItem[]) =>
  [...messages].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));

const buildSourceSummary = (
  source: ContextSource,
  messages: MessageItem[],
): ContextSourceSummary => {
  const messageCount = messages.length;
  const rangeStartTime = messages[0]?.sendTime;
  const rangeEndTime = messages[messages.length - 1]?.sendTime;
  const timeRange = formatTimeRange(rangeStartTime, rangeEndTime);

  if (source.kind === "recentMessages") {
    return {
      kind: source.kind,
      conversationID: source.conversationID,
      messageCount,
      title: `Recent ${messageCount} messages`,
      detail: `Recent messages from conversation ${source.conversationID}. Requested limit ${source.limit}. Time range: ${timeRange}.`,
      rangeStartTime,
      rangeEndTime,
    };
  }

  if (source.kind === "botTrigger") {
    return {
      kind: source.kind,
      conversationID: source.conversationID,
      messageCount,
      title: `Bot trigger context from ${messageCount} messages`,
      detail: `Bot trigger from conversation ${source.conversationID}. Trigger message: ${source.triggerMessageID}. Recent limit ${source.recentLimit}. Time range: ${timeRange}.`,
      rangeStartTime,
      rangeEndTime,
      triggerMessageID: source.triggerMessageID,
      triggerText: source.triggerText,
    };
  }

  const titleByKind = {
    selectedMessages: `Selected ${messageCount} messages`,
    historyMessages: `History ${messageCount} messages`,
    searchResults: `Search results ${messageCount} messages`,
  } as const;

  const detailByKind = {
    selectedMessages: `Selected messages from conversation ${source.conversationID}.`,
    historyMessages: `History messages from conversation ${source.conversationID}.`,
    searchResults: `Search-result messages from conversation ${source.conversationID}.`,
  } as const;

  const keywordPart = source.keyword ? ` Keyword: ${source.keyword}.` : "";
  const messageIDsPart =
    source.messageIDs.length > 0
      ? ` Message IDs: ${source.messageIDs.join(", ")}.`
      : "";

  return {
    kind: source.kind,
    conversationID: source.conversationID,
    messageCount,
    title: titleByKind[source.kind],
    detail: `${
      detailByKind[source.kind]
    } Time range: ${timeRange}.${keywordPart}${messageIDsPart}`.trim(),
    rangeStartTime,
    rangeEndTime,
    keyword: source.keyword,
  };
};

const summarizeAttachmentStatuses = (
  attachments: ContextAttachment[],
): ContextAttachmentStatusSummary => {
  const exported = attachments.filter(
    (attachment) => attachment.status === "exported",
  ).length;
  const referenced = attachments.filter(
    (attachment) => attachment.status === "referenced",
  ).length;
  const failed = attachments.filter(
    (attachment) => attachment.status === "failed",
  ).length;
  const unsupported = attachments.filter(
    (attachment) => attachment.status === "unsupported",
  ).length;
  const skipped = attachments.filter(
    (attachment) => attachment.status === "skipped",
  ).length;
  const total = attachments.length;
  const unresolved = referenced + failed + unsupported + skipped;

  return {
    total,
    exported,
    referenced,
    failed,
    unsupported,
    skipped,
    exportable: total - unsupported - skipped,
    unresolved,
    state:
      total === 0
        ? "none"
        : failed > 0
        ? "degraded"
        : unresolved > 0
        ? "partial"
        : "ready",
  };
};

const buildBundleStatus = (
  attachmentStatusSummary: ContextAttachmentStatusSummary,
): ContextBundleStatus => ({
  state:
    attachmentStatusSummary.state === "degraded"
      ? "degraded"
      : attachmentStatusSummary.state === "partial"
      ? "partial"
      : "ready",
  manifestVersion: 2,
  attachmentExportState: attachmentStatusSummary.state,
  hasAttachments: attachmentStatusSummary.total > 0,
  hasExportedAttachments: attachmentStatusSummary.exported > 0,
  hasUnresolvedAttachments: attachmentStatusSummary.unresolved > 0,
});

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
  bundle: Pick<
    ContextBundle,
    | "attachments"
    | "attachmentStatusSummary"
    | "files"
    | "sourceSummary"
    | "stats"
    | "status"
  >,
) => {
  const lines = [
    "You are running inside a terminal agent session.",
    "",
    "OpenIM source summary:",
    `- ${bundle.sourceSummary.title}`,
    `- ${bundle.sourceSummary.detail}`,
    "",
    `Bundle state: ${bundle.status.state}.`,
    "",
    "Read this OpenIM context file first:",
    "",
    bundle.files.markdownPath,
    "",
    "Inspect this manifest for attachment source metadata and export status:",
    "",
    bundle.files.manifestPath,
    "",
  ];

  if (bundle.stats.attachmentCount > 0) {
    lines.push(
      "Attachment status summary:",
      `- total=${bundle.attachmentStatusSummary.total}, exported=${bundle.attachmentStatusSummary.exported}, referenced=${bundle.attachmentStatusSummary.referenced}, failed=${bundle.attachmentStatusSummary.failed}, skipped=${bundle.attachmentStatusSummary.skipped}, unsupported=${bundle.attachmentStatusSummary.unsupported}`,
      "",
    );
  }

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
  }

  if (bundle.attachmentStatusSummary.unresolved > 0) {
    lines.push(
      "Some attachments are metadata-only or failed to export. Do not assume every attachment file exists locally.",
      "Check manifest status, error, and source fields before reading attachment paths.",
      "",
    );
  }

  if (bundle.sourceSummary.kind === "botTrigger") {
    lines.push(
      "Context source: botTrigger",
      `Message count: ${bundle.stats.messageCount}`,
      `Attachment count: ${bundle.stats.attachmentCount}`,
      "",
      "Trigger message:",
      bundle.sourceSummary.triggerText ?? "",
      "",
      "Bot request safety:",
      "Do not send messages back to OpenIM by yourself.",
      "Return your answer in the terminal. The user will review it before sending.",
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
  | "attachments"
  | "attachmentStatusSummary"
  | "manifest"
  | "markdown"
  | "promptText"
  | "sourceSummary"
  | "stats"
  | "status"
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
  const sourceSummary = buildSourceSummary(source, messages);
  const attachmentStatusSummary = summarizeAttachmentStatuses(attachments);
  const status = buildBundleStatus(attachmentStatusSummary);
  const sourceMeta =
    source.kind === "recentMessages"
      ? [`Limit: ${source.limit}`]
      : source.kind === "botTrigger"
      ? [
          `Context source: botTrigger`,
          `Trigger message: ${source.triggerMessageID}`,
          `Trigger text: ${source.triggerText}`,
          `Recent limit: ${source.recentLimit}`,
          `Message IDs: ${source.messageIDs.join(", ")}`,
        ]
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
    `Source Summary: ${sourceSummary.title}`,
    `Source Detail: ${sourceSummary.detail}`,
    `Bundle State: ${status.state}`,
    ...sourceMeta.map((item) => String(item)),
    "",
    "## Attachment Summary",
    "",
    `- State: ${attachmentStatusSummary.state}`,
    `- Total: ${attachmentStatusSummary.total}`,
    `- Exported: ${attachmentStatusSummary.exported}`,
    `- Referenced: ${attachmentStatusSummary.referenced}`,
    `- Failed: ${attachmentStatusSummary.failed}`,
    `- Skipped: ${attachmentStatusSummary.skipped}`,
    `- Unsupported: ${attachmentStatusSummary.unsupported}`,
    "",
    "## Messages",
    "",
    ...messageMarkdown.flatMap((item) => [item, ""]),
  ].join("\n");

  const stats = {
    messageCount: messages.length,
    attachmentCount: attachments.length,
    exportedAttachmentCount: attachmentStatusSummary.exported,
    referencedAttachmentCount: attachmentStatusSummary.referenced,
    failedAttachmentCount: attachmentStatusSummary.failed,
    unsupportedAttachmentCount: attachmentStatusSummary.unsupported,
    skippedAttachmentCount: attachmentStatusSummary.skipped,
    approxChars: markdown.length,
  };
  const manifestAttachments = attachments.map(serializeAttachmentForManifest);
  const manifest: ContextManifest = {
    id,
    createdAt,
    workspacePath,
    source,
    sourceSummary,
    status,
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
    attachmentStatusSummary,
    stats,
  };
  const promptText = createContextPrompt({
    sourceSummary,
    files,
    stats,
    attachments,
    attachmentStatusSummary,
    status,
  });

  return {
    attachments,
    attachmentStatusSummary,
    manifest,
    markdown,
    promptText,
    sourceSummary,
    stats,
    status,
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
    sourceSummary: buildSourceSummary(source, orderedMessages),
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
