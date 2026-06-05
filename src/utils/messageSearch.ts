import { MessageItem, MessageType, ViewType } from "@openim/wasm-client-sdk";

type OpenImSdkLike = {
  getAdvancedHistoryMessageList: (params: {
    conversationID: string;
    startClientMsgID: string;
    count: number;
    viewType: ViewType;
  }) => Promise<{ data: { messageList: MessageItem[]; isEnd?: boolean } }>;
  searchLocalMessages: (params: {
    conversationID: string;
    keywordList: string[];
    messageTypeList?: MessageType[];
    count: number;
    pageIndex: number;
  }) => Promise<{ data: unknown }>;
};

const conversationMessageCache = new Map<string, MessageItem[]>();

export function cacheConversationMessages(
  conversationID: string | undefined,
  messages: MessageItem[],
) {
  if (!conversationID) return;
  conversationMessageCache.set(conversationID, messages);
}

export function getCachedConversationMessages(conversationID: string | undefined) {
  return conversationID ? conversationMessageCache.get(conversationID) ?? [] : [];
}

export async function searchConversationMessages(input: {
  sdk: OpenImSdkLike;
  conversationID: string;
  keyword: string;
  messageType?: MessageType | "all";
  seedMessages?: MessageItem[];
  maxHistoryPages?: number;
  pageSize?: number;
}): Promise<MessageItem[]> {
  const keyword = input.keyword.trim();
  if (!keyword) return [];

  const messageType = input.messageType ?? "all";
  const pageSize = input.pageSize ?? 50;
  const maxHistoryPages = input.maxHistoryPages ?? 4;
  const results: MessageItem[] = [];
  const seen = new Set<string>();
  const add = (messages: MessageItem[]) => {
    for (const message of messages) {
      if (seen.has(message.clientMsgID)) continue;
      if (!matchesMessage(message, keyword, messageType)) continue;
      seen.add(message.clientMsgID);
      results.push(message);
    }
  };

  add(input.seedMessages ?? getCachedConversationMessages(input.conversationID));

  let startClientMsgID = "";
  for (let page = 0; page < maxHistoryPages; page += 1) {
    const { data } = await input.sdk.getAdvancedHistoryMessageList({
      conversationID: input.conversationID,
      startClientMsgID,
      count: pageSize,
      viewType: ViewType.History,
    });
    add(data.messageList ?? []);
    if (data.isEnd || !data.messageList?.length) break;
    startClientMsgID = data.messageList[data.messageList.length - 1]?.clientMsgID ?? "";
  }

  try {
    const { data } = await input.sdk.searchLocalMessages({
      conversationID: input.conversationID,
      keywordList: [keyword],
      messageTypeList: messageType === "all" ? undefined : [messageType as MessageType],
      count: pageSize,
      pageIndex: 1,
    });
    add(normalizeSearchResult(data));
  } catch {
    // Local message search is best-effort; history/current-list fallback is authoritative for UI.
  }

  return results;
}

export function matchesMessage(
  message: MessageItem,
  keyword: string,
  messageType: MessageType | "all" = "all",
) {
  if (messageType !== "all" && message.contentType !== messageType) return false;
  const normalized = keyword.toLowerCase();
  return getMessagePreview(message).toLowerCase().includes(normalized);
}

export function getMessagePreview(message: MessageItem): string {
  if (message.textElem?.content) return message.textElem.content;
  if (message.pictureElem) return "[Image]";
  if (message.fileElem) return `[File] ${message.fileElem.fileName}`;
  return `[${message.contentType}]`;
}

export function normalizeSearchResult(data: unknown): MessageItem[] {
  if (Array.isArray(data)) {
    return data as MessageItem[];
  }
  const result = data as {
    searchResultItems?: Array<{ messageList?: MessageItem[] }>;
    findResultItems?: Array<{ messageList?: MessageItem[] }>;
  };
  return (result.searchResultItems ?? result.findResultItems ?? []).flatMap(
    (item) => item.messageList ?? [],
  );
}
