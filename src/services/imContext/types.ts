import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { ContextAttachment } from "./attachments";

export type ContextSourceKind =
  | "recentMessages"
  | "selectedMessages"
  | "historyMessages"
  | "searchResults"
  | "botTrigger";

export type ContextAction = "preview" | "copy" | "send";

export type ContextBundleState = "ready" | "partial" | "degraded";

export interface ContextSourceSummary {
  kind: ContextSourceKind;
  conversationID: string;
  messageCount: number;
  title: string;
  detail: string;
  rangeStartTime?: number;
  rangeEndTime?: number;
  keyword?: string;
  triggerMessageID?: string;
  triggerText?: string;
}

export interface ContextAttachmentStatusSummary {
  total: number;
  exported: number;
  referenced: number;
  failed: number;
  unsupported: number;
  skipped: number;
  exportable: number;
  unresolved: number;
  state: "none" | "ready" | "partial" | "degraded";
}

export interface ContextBundleStats {
  messageCount: number;
  attachmentCount: number;
  exportedAttachmentCount: number;
  referencedAttachmentCount: number;
  failedAttachmentCount: number;
  unsupportedAttachmentCount: number;
  skippedAttachmentCount: number;
  approxChars: number;
}

export interface ContextBundleStatus {
  state: ContextBundleState;
  manifestVersion: number;
  attachmentExportState: ContextAttachmentStatusSummary["state"];
  hasAttachments: boolean;
  hasExportedAttachments: boolean;
  hasUnresolvedAttachments: boolean;
}

export type ContextSource =
  | {
      kind: "recentMessages";
      conversationID: string;
      limit: number;
    }
  | {
      kind: "selectedMessages" | "historyMessages" | "searchResults";
      conversationID: string;
      messageIDs: string[];
      keyword?: string;
    }
  | {
      kind: "botTrigger";
      conversationID: string;
      triggerMessageID: string;
      triggerText: string;
      messageIDs: string[];
      recentLimit: number;
    };

export interface ContextBundle {
  id: string;
  createdAt: number;
  workspacePath: string;
  source: ContextSource;
  sourceSummary: ContextSourceSummary;
  files: {
    markdownPath: string;
    manifestPath: string;
  };
  promptText: string;
  markdown: string;
  messages: MessageItem[];
  attachments: ContextAttachment[];
  attachmentStatusSummary: ContextAttachmentStatusSummary;
  status: ContextBundleStatus;
  manifest: ContextManifest;
  stats: ContextBundleStats;
}

export interface ContextManifest {
  id: string;
  createdAt: number;
  workspacePath: string;
  source: ContextSource;
  sourceSummary: ContextSourceSummary;
  status: ContextBundleStatus;
  messages: Array<{
    clientMsgID: string;
    contentType: number;
    sendTime?: number;
    senderNickname?: string;
    attachments: string[];
  }>;
  attachments: ContextAttachment[];
  attachmentStatusSummary: ContextAttachmentStatusSummary;
  stats: ContextBundleStats;
}
