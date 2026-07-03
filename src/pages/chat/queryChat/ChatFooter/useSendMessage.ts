import { MessageStatus } from "@openim/wasm-client-sdk";
import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";
import { SendMsgParams } from "@openim/wasm-client-sdk/lib/types/params";
import { useCallback } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { offlineIMService, OfflineMessageSender } from "@/services/offlineIM";
import { useConversationStore } from "@/store";
import { emit } from "@/utils/events";
import { getAuthMode } from "@/utils/storage";

import { pushNewMessage, updateOneMessage } from "../useHistoryMessageList";

export type SendMessageParams = Partial<Omit<SendMsgParams, "message">> & {
  message: MessageItem;
  needPush?: boolean;
  offlineSender?: OfflineMessageSender;
};

export function useSendMessage() {
  const sendMessage = useCallback(
    async ({
      recvID,
      groupID,
      message,
      needPush,
      offlineSender,
    }: SendMessageParams) => {
      const currentConversation = useConversationStore.getState().currentConversation;
      if (getAuthMode() === "offline") {
        const content = message.textElem?.content?.trim();
        if (!currentConversation?.conversationID || !content) return undefined;
        const offlineMessage = await offlineIMService.createTextMessage({
          conversationID: currentConversation.conversationID,
          sender: offlineSender ?? "self",
          content,
        });
        const conversationList = await offlineIMService.listConversations();
        const updatedCurrentConversation = conversationList.find(
          (item) => item.conversationID === currentConversation.conversationID,
        );
        useConversationStore.setState({
          conversationList,
          currentConversation: updatedCurrentConversation ?? currentConversation,
        });
        pushNewMessage(offlineMessage);
        emit("CHAT_LIST_SCROLL_TO_BOTTOM");
        return offlineMessage;
      }

      const sourceID = recvID || groupID;
      const inCurrentConversation =
        currentConversation?.userID === sourceID ||
        currentConversation?.groupID === sourceID ||
        !sourceID;
      needPush = needPush ?? inCurrentConversation;

      if (needPush) {
        pushNewMessage(message);
        emit("CHAT_LIST_SCROLL_TO_BOTTOM");
      }

      const options = {
        recvID: recvID ?? currentConversation?.userID ?? "",
        groupID: groupID ?? currentConversation?.groupID ?? "",
        message,
      };

      try {
        const { data: successMessage } = await IMSDK.sendMessage(options);
        updateOneMessage(successMessage);
        return successMessage;
      } catch (error) {
        updateOneMessage({
          ...message,
          status: MessageStatus.Failed,
        });
        return undefined;
      }
    },
    [],
  );

  return {
    sendMessage,
  };
}
