export type ContextAttachmentKind =
  | "image"
  | "file"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "unknown";

export type AttachmentExportStatus =
  | "exported"
  | "referenced"
  | "failed"
  | "unsupported"
  | "skipped";

export interface ContextAttachmentSource {
  conversationID: string;
  clientMsgID: string;
  serverMsgID?: string;
  senderUserID?: string;
  senderNickname?: string;
  sendTime?: number;
  contentType?: number;
  seq?: number;
}

export interface ContextAttachment {
  attachmentId: string;
  source: ContextAttachmentSource;
  kind: ContextAttachmentKind;
  mime?: string;
  displayName: string;
  workspaceRelativePath?: string;
  workspaceAbsolutePath?: string;
  logicalUri: string;
  sourceUrl?: string;
  sourceLocalPath?: string;
  size?: number;
  sha256?: string;
  status: AttachmentExportStatus;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface AttachmentExportResult {
  path?: string;
  size?: number;
  sha256?: string;
}
