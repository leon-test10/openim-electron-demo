import { MessageStatus, MessageType } from "@openim/wasm-client-sdk";
import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";
import { v4 as uuidV4 } from "uuid";

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
import {
  createFolderSharePayload,
  FOLDER_SHARE_SCHEMA,
  parseFolderShareMessage,
} from "@/utils/folderShare";
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

type FolderScanResult = {
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
};

const scanFolder = async (attachment: AgentDeliveryAttachment) => {
  const scan = await window.electronAPI?.ipcInvoke<FolderScanResult>("folder:scan", {
    nativePath: attachment.nativePath,
    folderName: attachment.fileName,
  });
  if (!scan) throw new Error(`Cannot scan output folder: ${attachment.path}`);
  return scan;
};

const sendAttachment = async (
  conversationID: string,
  attachment: AgentDeliveryAttachment,
) => {
  const { getFileMessage, getFolderMessage, getImageMessage } =
    createFileMessageHelpers();
  if (attachment.kind === "folder") {
    const scan = await scanFolder(attachment);
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

const sendOfflineAttachment = async (
  conversationID: string,
  attachment: AgentDeliveryAttachment,
) => {
  if (attachment.kind === "folder") {
    const scan = await scanFolder(attachment);
    const shareID = uuidV4();
    const manifest = {
      schema: FOLDER_SHARE_SCHEMA as "openim-agent.folder-share.v1",
      shareID,
      folderName: scan.folderName || attachment.fileName,
      itemCount: scan.itemCount,
      totalSize: scan.totalSize,
      createdAt: Date.now(),
      files: scan.files.map((file) => ({
        relativePath: file.relativePath,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
      })),
    };
    const sent = await offlineIMService.createMessage({
      conversationID,
      sender: "self",
      message: {
        contentType: MessageType.CustomMessage,
        customElem: createFolderSharePayload(manifest),
      } as MessageItem,
    });
    recordLocalFolderShare(shareID, manifest.folderName, attachment.nativePath);
    return sent;
  }
  const sent = await offlineIMService.createMessage({
    conversationID,
    sender: "self",
    message: {
      contentType: MessageType.FileMessage,
      fileElem: {
        filePath: attachment.nativePath,
        uuid: uuidV4(),
        sourceUrl: "",
        fileName: attachment.fileName,
        fileSize: attachment.size ?? 0,
      },
    } as MessageItem,
  });
  recordLocalFileForMessage(
    sent.clientMsgID,
    attachment.fileName,
    attachment.nativePath,
  );
  return sent;
};

export const deliverAgentOutput = async (
  request: AgentDeliveryRequest,
): Promise<AgentDeliveryResponse> => {
  const response: AgentDeliveryResponse = {
    requestID: request.requestID,
    sessionID: request.sessionID,
    messageID: request.messageID,
    resultID: request.resultID,
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
        const sent = await sendOfflineAttachment(request.conversationID, attachment);
        await refreshOfflineConversations(request.conversationID);
        if (
          useConversationStore.getState().currentConversation?.conversationID ===
          request.conversationID
        ) {
          pushNewMessage(sent);
        }
      } else {
        await sendAttachment(request.conversationID, attachment);
      }
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
