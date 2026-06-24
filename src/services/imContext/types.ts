import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { ContextAttachment } from "./attachments";

export type ContextSourceKind =
  | "recentMessages"
  | "selectedMessages"
  | "historyMessages"
  | "searchResults";

export type ContextAction = "preview" | "copy" | "send";

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
  messages: MessageItem[];
  attachments: ContextAttachment[];
  manifest: ContextManifest;
  stats: {
    messageCount: number;
    attachmentCount: number;
    exportedAttachmentCount: number;
    failedAttachmentCount: number;
    unsupportedAttachmentCount: number;
    approxChars: number;
  };
}

export interface ContextManifest {
  id: string;
  createdAt: number;
  workspacePath: string;
  source: ContextSource;
  messages: Array<{
    clientMsgID: string;
    contentType: number;
    sendTime?: number;
    senderNickname?: string;
    attachments: string[];
  }>;
  attachments: ContextAttachment[];
  stats: ContextBundle["stats"];
}
