import { MessageType, SessionType, ViewType } from "@openim/wasm-client-sdk";
import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { IMSDK } from "@/layout/MainContentWrap";
import {
  detectBotTrigger,
  extractTextMessageContent,
  isAgentGeneratedMessage,
} from "@/services/botTrigger";
import { offlineIMService } from "@/services/offlineIM";
import { useAgentSessionStore, useConversationStore, useUserStore } from "@/store";
import type { BotRequest } from "@/types/agentSession";
import { getAuthMode } from "@/utils/storage";

import { splitHistoryPageAfterCheckpoint } from "./botCheckpoint";
import { loadRecentConversationMessages, persistAgentContextBundle } from "./context";

const textFromMessage = (message: MessageItem) => {
  if (message.contentType === MessageType.TextMessage) {
    return extractTextMessageContent(message);
  }
  return message.atTextElem?.text ?? "";
};

const resolveConversationID = (message: MessageItem) => {
  const messageWithConversation = message as MessageItem & {
    conversationID?: string;
    sessionType: number;
  };
  if (messageWithConversation.conversationID)
    return messageWithConversation.conversationID;
  const selfID = useUserStore.getState().selfInfo.userID;
  return useConversationStore.getState().conversationList.find((conversation) => {
    if (
      messageWithConversation.sessionType === Number(SessionType.Group) ||
      messageWithConversation.sessionType === Number(SessionType.WorkingGroup)
    ) {
      return conversation.groupID === message.groupID;
    }
    const peerID = message.sendID === selfID ? message.recvID : message.sendID;
    return conversation.userID === peerID;
  })?.conversationID;
};

export const executeAgentBotRequest = async (request: BotRequest) => {
  const store = useAgentSessionStore.getState();
  const session = await store.ensureBotSession(request.conversationID);
  const messages = await loadBotRequestContextMessages(request);
  const context = await persistAgentContextBundle({
    session,
    source: {
      kind: "botTrigger",
      conversationID: request.conversationID,
      triggerMessageID: request.triggerMessageID,
      triggerText: request.triggerText,
      messageIDs: messages.map((item) => item.clientMsgID),
      recentLimit: request.contextLimit,
    },
    messages,
  });
  await store.runBotRequest({
    requestID: request.id,
    prompt: `${context.bundle.promptText}\n\n${request.instructionText}`,
    contextPaths: context.paths,
  });
};

async function loadBotRequestContextMessages(request: BotRequest) {
  const precedingCount = Math.max(request.contextLimit - 1, 0);
  let preceding: MessageItem[] = [];
  let triggerMessage: MessageItem | undefined;
  if (getAuthMode() === "offline") {
    if (precedingCount > 0) {
      preceding = (
        await offlineIMService.listMessages({
          conversationID: request.conversationID,
          count: precedingCount,
          startClientMsgID: request.triggerMessageID,
        })
      ).messageList;
    }
    triggerMessage = (
      await offlineIMService.getMessagesByClientMsgIDs(request.conversationID, [
        request.triggerMessageID,
      ])
    )[0];
  } else {
    if (precedingCount > 0) {
      const { data } = await IMSDK.getAdvancedHistoryMessageList({
        conversationID: request.conversationID,
        count: precedingCount,
        startClientMsgID: request.triggerMessageID,
        viewType: ViewType.History,
      });
      preceding = data.messageList;
    }
    const { data } = await IMSDK.findMessageList([
      {
        conversationID: request.conversationID,
        clientMsgIDList: [request.triggerMessageID],
      },
    ]);
    const groups = data.searchResultItems ?? data.findResultItems ?? [];
    triggerMessage = groups.flatMap((group) => group.messageList ?? [])[0];
  }
  triggerMessage ??= {
    clientMsgID: request.triggerMessageID,
    sendID: request.senderUserID,
    senderNickname: request.senderNickname,
    contentType: MessageType.TextMessage,
    textElem: { content: request.triggerText },
    sendTime: request.createdAt,
  } as MessageItem;
  return [...preceding, triggerMessage]
    .sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0))
    .slice(-request.contextLimit);
}

export const routeIncomingBotMessage = async (
  message: MessageItem,
  options: { backfill?: boolean } = {},
) => {
  const self = useUserStore.getState().selfInfo;
  if (!self.userID) return;
  const conversationID = resolveConversationID(message);
  if (!conversationID) return;
  const store = useAgentSessionStore.getState();
  try {
    if (isAgentGeneratedMessage(message)) return;
    const text = textFromMessage(message);
    if (!text.trim()) return;

    const structuredMentions = message.atTextElem?.atUserList ?? [];
    if (structuredMentions.length > 0 && !structuredMentions.includes(self.userID))
      return;
    const structuredSelf = message.atTextElem?.atUsersInfo?.find(
      (item) => item.atUserID === self.userID,
    );
    const trigger = detectBotTrigger({
      text,
      currentUserID: self.userID,
      conversationType:
        Number(message.sessionType) === Number(SessionType.Group) ||
        Number(message.sessionType) === Number(SessionType.WorkingGroup)
          ? "group"
          : "single",
      targetCandidates: [
        {
          userID: self.userID,
          nickname: structuredSelf?.groupNickname || self.nickname,
        },
      ],
    });
    if (!trigger || trigger.targetUserID !== self.userID) return;

    const policy = store.botPolicyByConversation[conversationID] ?? "review";
    if (policy === "off") return;
    const now = Date.now();
    const request: BotRequest = {
      id: `bot_request_${message.clientMsgID}`,
      conversationID,
      triggerMessageID: message.clientMsgID,
      triggerText: text,
      instructionText: trigger.instructionText,
      senderUserID: message.sendID,
      senderNickname: message.senderNickname,
      targetUserID: self.userID,
      contextLimit: Math.min(
        Math.max(store.botContextLimitByConversation[conversationID] ?? 20, 1),
        200,
      ),
      status: "pending_review",
      createdAt: now,
      updatedAt: now,
    };
    const added = await store.addBotRequest(request);
    if (added && policy === "auto" && !options.backfill) {
      await executeAgentBotRequest(request);
    }
  } finally {
    if (!options.backfill) {
      await store.setBotCheckpoint(conversationID, message.clientMsgID);
    }
  }
};

let botRouteQueue: Promise<void> = Promise.resolve();

export const queueIncomingBotMessage = (
  message: MessageItem,
  options: { backfill?: boolean } = {},
) => {
  const result = botRouteQueue.then(() => routeIncomingBotMessage(message, options));
  botRouteQueue = result.catch(() => undefined);
  return result;
};

const loadBotHistoryPage = async (
  conversationID: string,
  beforeClientMsgID?: string,
) => {
  if (getAuthMode() === "offline") {
    return offlineIMService.listMessages({
      conversationID,
      count: 200,
      startClientMsgID: beforeClientMsgID,
    });
  }
  const { data } = await IMSDK.getAdvancedHistoryMessageList({
    conversationID,
    count: 200,
    startClientMsgID: beforeClientMsgID ?? "",
    viewType: ViewType.History,
  });
  return data;
};

const loadMessagesAfterCheckpoint = async (
  conversationID: string,
  checkpointClientMsgID?: string,
) => {
  let beforeClientMsgID: string | undefined;
  let collected: MessageItem[] = [];
  for (;;) {
    const page = await loadBotHistoryPage(conversationID, beforeClientMsgID);
    const split = splitHistoryPageAfterCheckpoint(
      page.messageList,
      checkpointClientMsgID,
    );
    collected = [...split.messages, ...collected];
    if (split.checkpointFound || page.isEnd || page.messageList.length === 0) break;
    const nextCursor = page.messageList[0]?.clientMsgID;
    if (!nextCursor || nextCursor === beforeClientMsgID) break;
    beforeClientMsgID = nextCursor;
  }
  return collected;
};

export const backfillBotRequests = async () => {
  const conversations = useConversationStore.getState().conversationList;
  for (const conversation of conversations) {
    try {
      const store = useAgentSessionStore.getState();
      const messages = await loadMessagesAfterCheckpoint(
        conversation.conversationID,
        store.botCheckpointByConversation[conversation.conversationID],
      );
      for (const message of messages) {
        await queueIncomingBotMessage(message, { backfill: true });
      }
      const latestMessageID = messages.at(-1)?.clientMsgID;
      if (latestMessageID) {
        await store.setBotCheckpoint(conversation.conversationID, latestMessageID);
      }
    } catch {
      // A failed conversation history scan must not block the global IM sync.
    }
  }
};
