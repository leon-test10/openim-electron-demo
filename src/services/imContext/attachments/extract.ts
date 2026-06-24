import { MessageItem, MessageType } from "@openim/wasm-client-sdk";

import { ContextAttachment } from "./types";
import {
  generateAttachmentId,
  getAttachmentWorkspacePath,
  inferKindFromFileName,
  mimeFromName,
} from "./utils";

const withAttachmentIdentity = (
  attachment: Omit<ContextAttachment, "attachmentId" | "logicalUri">,
  bundleId: string,
  index: number,
): ContextAttachment => {
  const attachmentId = generateAttachmentId({
    clientMsgID: attachment.source.clientMsgID,
    index,
    sourceUrl: attachment.sourceUrl,
    sourceLocalPath: attachment.sourceLocalPath,
    displayName: attachment.displayName,
    size: attachment.size,
    mime: attachment.mime,
  });

  const shouldExport =
    attachment.kind !== "video" &&
    attachment.kind !== "audio" &&
    attachment.status !== "unsupported" &&
    Boolean(attachment.sourceLocalPath || attachment.sourceUrl);

  return {
    ...attachment,
    attachmentId,
    logicalUri: `im-attachment://${bundleId}/${attachmentId}`,
    workspaceRelativePath: shouldExport
      ? getAttachmentWorkspacePath({
          bundleId,
          clientMsgID: attachment.source.clientMsgID,
          attachmentId,
          displayName: attachment.displayName,
        })
      : undefined,
  };
};

export const extractMessageAttachments = ({
  message,
  conversationID,
  bundleId,
}: {
  message: MessageItem;
  conversationID: string;
  bundleId: string;
}): ContextAttachment[] => {
  const source = {
    conversationID,
    clientMsgID: message.clientMsgID,
    serverMsgID: message.serverMsgID,
    senderUserID: message.sendID,
    senderNickname: message.senderNickname,
    sendTime: message.sendTime,
    contentType: message.contentType,
    seq: message.seq,
  };

  if (message.contentType === MessageType.PictureMessage && message.pictureElem) {
    const picture =
      message.pictureElem.sourcePicture ??
      message.pictureElem.bigPicture ??
      message.pictureElem.snapshotPicture;
    const displayName = picture?.uuid || `${message.clientMsgID}.png`;

    return [
      withAttachmentIdentity(
        {
          source,
          kind: "image",
          mime: mimeFromName(displayName) ?? picture?.type,
          displayName,
          sourceUrl: picture?.url,
          sourceLocalPath: message.pictureElem.sourcePath,
          size: picture?.size,
          status:
            picture?.url || message.pictureElem.sourcePath ? "referenced" : "failed",
          error:
            picture?.url || message.pictureElem.sourcePath
              ? undefined
              : "No image source",
          meta: {
            width: picture?.width,
            height: picture?.height,
            uuid: picture?.uuid,
            snapshotUrl: message.pictureElem.snapshotPicture?.url,
          },
        },
        bundleId,
        0,
      ),
    ];
  }

  if (message.contentType === MessageType.FileMessage && message.fileElem) {
    const displayName = message.fileElem.fileName || `${message.clientMsgID}.file`;
    const kind = inferKindFromFileName(displayName);

    return [
      withAttachmentIdentity(
        {
          source,
          kind,
          mime: mimeFromName(displayName),
          displayName,
          sourceUrl: message.fileElem.sourceUrl,
          sourceLocalPath: message.fileElem.filePath,
          size: message.fileElem.fileSize,
          status:
            message.fileElem.sourceUrl || message.fileElem.filePath
              ? "referenced"
              : "failed",
          error:
            message.fileElem.sourceUrl || message.fileElem.filePath
              ? undefined
              : "No file source",
          meta: {
            uuid: message.fileElem.uuid,
          },
        },
        bundleId,
        0,
      ),
    ];
  }

  if (message.contentType === MessageType.VideoMessage && message.videoElem) {
    const displayName =
      message.videoElem.videoUUID ||
      `${message.clientMsgID}.${message.videoElem.videoType || "video"}`;

    return [
      withAttachmentIdentity(
        {
          source,
          kind: "video",
          mime: mimeFromName(displayName) ?? message.videoElem.videoType,
          displayName,
          sourceUrl: message.videoElem.videoUrl,
          sourceLocalPath: message.videoElem.videoPath,
          size: message.videoElem.videoSize,
          status: "skipped",
          error: "Video export is skipped in P7 to avoid large workspace files",
          meta: {
            duration: message.videoElem.duration,
            snapshotUrl: message.videoElem.snapshotUrl,
            snapshotPath: message.videoElem.snapshotPath,
          },
        },
        bundleId,
        0,
      ),
    ];
  }

  if (message.contentType === MessageType.VoiceMessage && message.soundElem) {
    const displayName = message.soundElem.uuid || `${message.clientMsgID}.audio`;

    return [
      withAttachmentIdentity(
        {
          source,
          kind: "audio",
          mime: mimeFromName(displayName),
          displayName,
          sourceUrl: message.soundElem.sourceUrl,
          sourceLocalPath: message.soundElem.soundPath,
          size: message.soundElem.dataSize,
          status: "skipped",
          error: "Audio export is skipped in P7 to avoid large workspace files",
          meta: {
            duration: message.soundElem.duration,
            uuid: message.soundElem.uuid,
          },
        },
        bundleId,
        0,
      ),
    ];
  }

  if (message.contentType !== MessageType.TextMessage) {
    return [
      withAttachmentIdentity(
        {
          source,
          kind: "unknown",
          displayName: `${message.clientMsgID}.unsupported`,
          status: "unsupported",
          error: `Unsupported message content type: ${message.contentType}`,
        },
        bundleId,
        0,
      ),
    ];
  }

  return [];
};
