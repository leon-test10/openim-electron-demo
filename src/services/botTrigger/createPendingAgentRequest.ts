import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { BotTriggerResult, PendingAgentRequest } from "./types";

const createID = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function createPendingAgentRequest(args: {
  conversationID: string;
  triggerMessage: MessageItem;
  trigger: BotTriggerResult;
  contextMessages: MessageItem[];
  isGroup: boolean;
  recentLimit?: number;
}): PendingAgentRequest {
  return {
    id: createID("bot_req"),
    conversationID: args.conversationID,
    triggerMessageID: args.triggerMessage.clientMsgID,
    triggerText: args.trigger.rawText,
    instructionText: args.trigger.instructionText,
    senderUserID: args.triggerMessage.sendID,
    senderNickname: args.triggerMessage.senderNickname,
    createdAt: Date.now(),
    triggerKind: args.trigger.triggerKind,
    contextScope: {
      mode: "recentMessages",
      recentLimit: args.recentLimit ?? args.contextMessages.length,
    },
    status: "pending",
    isGroup: args.isGroup,
    contextMessages: args.contextMessages,
    targetUserID: args.trigger.targetUserID,
  };
}
