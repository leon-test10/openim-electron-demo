import { MessageStatus } from "@openim/wasm-client-sdk";
import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { IMSDK } from "@/layout/MainContentWrap";
import { createFileMessageHelpers } from "@/pages/chat/queryChat/ChatFooter/SendActionBar/useFileMessage";
import {
  pushNewMessage,
  updateOneMessage,
} from "@/pages/chat/queryChat/useHistoryMessageList";
import { offlineIMService } from "@/services/offlineIM";
import { useConversationStore } from "@/store";
import type {
  AgentDeliveryAttachment,
  AgentDeliveryRequest,
  AgentDeliveryResponse,
} from "@/types/agentSession";
import { parseFolderShareMessage } from "@/utils/folderShare";
import { recordLocalFileForMessage } from "@/utils/localFileCache";
import { recordLocalFolderShare } from "@/utils/localFolderShareCache";
import { getAuthMode } from "@/utils/storage";

const refreshOfflineConversations = async (conversationID: string) => {
  const conversationList = await offlineIMService.listConversations();
  const current = useConversationStore.getState().currentConversation;
  useConversationStore.setState({
    conversationList,
    currentConversation:
      current?.conversationID === conversationID
        ? conversationList.find((item) => item.conversationID === conversationID) ??
          current
        : current,
  });
};

const sendOnlineMessage = async (conversationID: string, message: MessageItem) => {
  const state = useConversationStore.getState();
  const conversation = state.conversationList.find(
    (item) => item.conversationID === conversationID,
  );
  if (!conversation) throw new Error("Bound IM conversation is unavailable");
  const visible = state.currentConversation?.conversationID === conversationID;
  if (visible) pushNewMessage(message);
  try {
    const result = await IMSDK.sendMessage({
      recvID: conversation.userID ?? "",
      groupID: conversation.groupID ?? "",
      message,
    });
    if (visible) updateOneMessage(result.data);
    return result.data;
  } catch (error) {
    if (visible) updateOneMessage({ ...message, status: MessageStatus.Failed });
    throw error;
  }
};

const sendAttachment = async (
  conversationID: string,
  attachment: AgentDeliveryAttachment,
) => {
  const { getFileMessage, getFolderMessage, getImageMessage } =
    createFileMessageHelpers();
  if (attachment.kind === "folder") {
    const scan = await window.electronAPI?.ipcInvoke<{
      folderName: string;
      itemCount: number;
      totalSize: number;
      files: Array<{
        relativePath: string;
        fileName: string;
        nativePath?: string;
        size: number;
        mimeType?: string;
      }>;
    }>("folder:scan", {
      nativePath: attachment.nativePath,
      folderName: attachment.fileName,
    });
    if (!scan) throw new Error(`Cannot scan output folder: ${attachment.path}`);
    const message = await getFolderMessage({
      nativePath: attachment.nativePath,
      folderName: scan.folderName || attachment.fileName,
      itemCount: scan.itemCount,
      totalSize: scan.totalSize,
      files: scan.files,
    });
    await sendOnlineMessage(conversationID, message);
    const manifest = parseFolderShareMessage(message);
    if (manifest?.shareID) {
      recordLocalFolderShare(
        manifest.shareID,
        manifest.folderName,
        attachment.nativePath,
      );
    }
    return;
  }
  const input = {
    nativePath: attachment.nativePath,
    fileName: attachment.fileName,
    fileSize: attachment.size,
  };
  const message =
    attachment.kind === "image"
      ? await getImageMessage(input)
      : await getFileMessage(input);
  const sent = await sendOnlineMessage(conversationID, message);
  recordLocalFileForMessage(
    sent.clientMsgID || message.clientMsgID,
    attachment.fileName,
    attachment.nativePath,
  );
};

export const deliverAgentOutput = async (
  request: AgentDeliveryRequest,
): Promise<AgentDeliveryResponse> => {
  const response: AgentDeliveryResponse = {
    requestID: request.requestID,
    sessionID: request.sessionID,
    messageID: request.messageID,
    textSent: false,
    sentAttachmentPaths: [],
    errors: [],
  };
  if (request.text) {
    try {
      if (getAuthMode() === "offline") {
        const sent = await offlineIMService.createTextMessage({
          conversationID: request.conversationID,
          sender: "self",
          content: request.text,
        });
        await refreshOfflineConversations(request.conversationID);
        if (
          useConversationStore.getState().currentConversation?.conversationID ===
          request.conversationID
        ) {
          pushNewMessage(sent);
        }
      } else {
        const message = (await IMSDK.createTextMessage(request.text)).data;
        await sendOnlineMessage(request.conversationID, message);
      }
      response.textSent = true;
    } catch (error) {
      response.errors!.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const attachment of request.attachments) {
    try {
      if (getAuthMode() === "offline") {
        throw new Error("Offline mode does not support file or folder messages");
      }
      await sendAttachment(request.conversationID, attachment);
      response.sentAttachmentPaths.push(attachment.path);
    } catch (error) {
      response.errors!.push(
        `${attachment.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (response.errors?.length === 0) delete response.errors;
  return response;
};
