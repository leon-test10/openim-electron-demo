import { MessageItem } from "@openim/wasm-client-sdk";
import { message as antdMessage } from "antd";
import { t } from "i18next";

import { IMSDK } from "@/layout/MainContentWrap";
import { ChooseModalState } from "@/pages/common/ChooseModal";
import { CheckListItem } from "@/pages/common/ChooseModal/ChooseBox/CheckItem";
import {
  MessageForwardMode,
  useMessageForwardStore,
  useMessageSelectionStore,
} from "@/store";
import emitter from "@/utils/events";
import {
  getMessageSender,
  getPlainMessageContent,
  sortSelectedMessages,
} from "@/utils/messageSelectionFormat";

const buildSelectTargetModalState = (): ChooseModalState => ({
  type: "SELECT_USER",
  extraData: {
    notConversation: true,
    list: [],
    includeGroups: true,
  },
});

const buildMergerSummaryList = (messages: MessageItem[]) =>
  sortSelectedMessages(messages)
    .slice(0, 4)
    .map((message) => {
      const sender = getMessageSender(message);
      const content = getPlainMessageContent(message).replace(/\s+/g, " ").trim();
      return `${sender}: ${content}`.slice(0, 80);
    });

const getTargetSendParams = (target: CheckListItem) => ({
  recvID: target.userID ?? "",
  groupID: target.groupID ?? "",
});

export const openMessageForwardChooser = (
  conversationID: string,
  messages: MessageItem[],
  mode: MessageForwardMode,
) => {
  const normalizedMessages = sortSelectedMessages(messages);
  if (!conversationID || normalizedMessages.length === 0) return;

  useMessageForwardStore.getState().setPendingRequest({
    conversationID,
    messages: normalizedMessages,
    mode,
  });
  emitter.emit("OPEN_CHOOSE_MODAL", buildSelectTargetModalState());
};

export const consumePendingForwardSelection = async (targets: CheckListItem[]) => {
  const request = useMessageForwardStore.getState().pendingRequest;
  if (!request) return false;

  useMessageForwardStore.getState().clearPendingRequest();
  if (!targets.length) return true;

  const selectedTargets = targets.filter((item) => item.userID || item.groupID);
  if (!selectedTargets.length) return true;

  const messages = sortSelectedMessages(request.messages);
  const failures: unknown[] = [];
  let sentCount = 0;

  for (const target of selectedTargets) {
    try {
      if (request.mode === "merged") {
        const { data: mergerMessage } = await IMSDK.createMergerMessage({
          messageList: messages,
          title: t("messageSelection.mergeForwardTitle", {
            count: messages.length,
          }),
          summaryList: buildMergerSummaryList(messages),
        });
        await IMSDK.sendMessage({
          ...getTargetSendParams(target),
          message: mergerMessage,
        });
        sentCount += 1;
        continue;
      }

      for (const message of messages) {
        const { data: forwardMessage } = await IMSDK.createForwardMessage(message);
        await IMSDK.sendMessage({
          ...getTargetSendParams(target),
          message: forwardMessage,
        });
        sentCount += 1;
      }
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length) {
    antdMessage.error(t("messageSelection.forwardFailed"));
  } else {
    antdMessage.success(
      t("messageSelection.forwardSuccess", {
        count: sentCount,
      }),
    );
  }

  useMessageSelectionStore.getState().clearSelection(request.conversationID);
  return true;
};
