import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

export type BotTriggerKind = "mentionBot" | "slashBot";

export type BotConversationType = "single" | "group";

export type PendingAgentRequestStatus = "pending" | "sent" | "ignored" | "dismissed";

export interface BotTriggerResult {
  triggerKind: BotTriggerKind;
  alias: string;
  rawText: string;
  instructionText: string;
  /** The @mentioned user whose terminal should process this request. */
  targetUserID?: string;
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
  /** The @mentioned target user for this request. */
  targetUserID?: string;
}
