import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

export type BotTriggerKind = "mentionBot" | "slashBot";

export type BotConversationType = "single" | "group";

export type PendingAgentRequestStatus = "pending" | "sent" | "ignored" | "dismissed";

export interface BotTriggerResult {
  triggerKind: BotTriggerKind;
  alias: string;
  rawText: string;
  instructionText: string;
}

export interface PendingAgentRequest {
  id: string;
  conversationID: string;
  triggerMessageID: string;
  triggerText: string;
  instructionText: string;
  senderUserID: string;
  senderNickname?: string;
  createdAt: number;
  triggerKind: BotTriggerKind;
  contextScope: {
    mode: "triggerOnly" | "recentMessages";
    recentLimit?: number;
  };
  status: PendingAgentRequestStatus;
  isGroup: boolean;
  contextMessages: MessageItem[];
}
