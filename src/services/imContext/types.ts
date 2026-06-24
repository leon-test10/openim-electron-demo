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
