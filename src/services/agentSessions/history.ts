import { MessageType, ViewType } from "@openim/wasm-client-sdk";
import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { IMSDK } from "@/layout/MainContentWrap";
import { offlineIMService } from "@/services/offlineIM";
import type {
  AgentHistoryQueryRequest,
  AgentHistoryQueryResponse,
  IMHistoryMessage,
} from "@/types/agentSession";
import { getAuthMode } from "@/utils/storage";

const stripHTML = (value?: string) =>
  (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

const messageText = (message: MessageItem) => {
  if (message.contentType === MessageType.TextMessage) {
    return stripHTML(message.textElem?.content);
  }
  if (message.contentType === MessageType.PictureMessage) return "[image]";
  if (message.contentType === MessageType.FileMessage) {
    return `[file] ${message.fileElem?.fileName ?? "unnamed"}`;
  }
  if (message.contentType === MessageType.VideoMessage) return "[video]";
  if (message.contentType === MessageType.VoiceMessage) return "[audio]";
  return `[message type ${message.contentType}]`;
};

export const normalizeIMHistoryMessage = (message: MessageItem): IMHistoryMessage => {
  const attachments: IMHistoryMessage["attachments"] = [];
  if (message.pictureElem) {
    attachments.push({
      kind: "image",
      url:
        message.pictureElem.sourcePicture?.url ??
        message.pictureElem.bigPicture?.url ??
        message.pictureElem.snapshotPicture?.url,
    });
  }
  if (message.fileElem) {
    attachments.push({
      kind: "file",
      name: message.fileElem.fileName,
      url: message.fileElem.sourceUrl,
      size: message.fileElem.fileSize,
    });
  }
  if (message.videoElem) {
    attachments.push({
      kind: "video",
      name: message.videoElem.videoUUID,
      url: message.videoElem.videoUrl,
      size: message.videoElem.videoSize,
    });
  }
  if (message.soundElem) {
    attachments.push({
      kind: "audio",
      name: message.soundElem.uuid,
      url: message.soundElem.sourceUrl,
      size: message.soundElem.dataSize,
    });
  }
  return {
    clientMsgID: message.clientMsgID,
    senderUserID: message.sendID,
    senderNickname: message.senderNickname,
    sendTime: message.sendTime,
    contentType: message.contentType,
    text: messageText(message),
    attachments,
  };
};

const flattenSearchResults = (value: unknown): MessageItem[] => {
  if (!value || typeof value !== "object") return [];
  const result = value as {
    searchResultItems?: Array<{ messageList?: MessageItem[] }>;
    findResultItems?: Array<{ messageList?: MessageItem[] }>;
  };
  return [...(result.searchResultItems ?? []), ...(result.findResultItems ?? [])]
    .flatMap((item) => item.messageList ?? [])
    .sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));
};

const queryMessages = async (request: AgentHistoryQueryRequest) => {
  const limit = Math.min(Math.max(request.query.limit ?? 20, 1), 100);
  const offline = getAuthMode() === "offline";
  if (request.query.mode === "recent") {
    if (offline) {
      const result = await offlineIMService.listMessages({
        conversationID: request.conversationID,
        count: limit,
        startClientMsgID: request.query.beforeClientMsgID,
      });
      return { messages: result.messageList, isEnd: result.isEnd };
    }
    const { data } = await IMSDK.getAdvancedHistoryMessageList({
      conversationID: request.conversationID,
      count: limit,
      startClientMsgID: request.query.beforeClientMsgID ?? "",
      viewType: ViewType.History,
    });
    return { messages: data.messageList, isEnd: data.isEnd };
  }

  const keyword = request.query.keyword?.trim().toLocaleLowerCase() ?? "";
  if (offline) {
    const result = await offlineIMService.listMessages({
      conversationID: request.conversationID,
      count: 1000,
    });
    const filtered = result.messageList
      .filter((message) => messageText(message).toLocaleLowerCase().includes(keyword))
      .slice(-limit);
    return { messages: filtered, isEnd: filtered.length < limit };
  }
  const { data } = await IMSDK.searchLocalMessages({
    conversationID: request.conversationID,
    keywordList: [keyword],
    keywordListMatchType: 0,
    pageIndex: 1,
    count: limit,
  });
  const messages = flattenSearchResults(data).slice(-limit);
  return { messages, isEnd: messages.length < limit };
};

export const answerAgentHistoryQuery = async (
  request: AgentHistoryQueryRequest,
): Promise<AgentHistoryQueryResponse> => {
  try {
    const result = await queryMessages(request);
    return {
      requestID: request.requestID,
      result: {
        messages: result.messages.map(normalizeIMHistoryMessage),
        isEnd: result.isEnd,
        nextCursor: result.messages[0]?.clientMsgID,
      },
    };
  } catch (error) {
    return {
      requestID: request.requestID,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
