import { MessageType, SessionType } from "@openim/wasm-client-sdk";
import {
  ConversationItem,
  MessageItem,
} from "@openim/wasm-client-sdk/lib/types/entity";

export const e2eConversationID = "si_e2e_user_peer";

export const e2eConversation = {
  conversationID: e2eConversationID,
  conversationType: SessionType.Single,
  userID: "e2e_peer",
  showName: "E2E Peer",
  faceURL: "",
  recvMsgOpt: 0,
  unreadCount: 0,
  groupID: "",
  latestMsg: "",
  latestMsgSendTime: Date.now(),
  draftText: "",
  isPinned: false,
  isPrivateChat: false,
  burnDuration: 0,
  attachedInfo: "",
  ex: "",
} as ConversationItem;

export const createE2ETextMessage = (
  clientMsgID: string,
  content: string,
  sendTimeOffset: number,
) =>
  ({
    clientMsgID,
    serverMsgID: clientMsgID,
    conversationID: e2eConversationID,
    sendID: clientMsgID.endsWith("1") ? "e2e_self" : "e2e_peer",
    recvID: clientMsgID.endsWith("1") ? "e2e_peer" : "e2e_self",
    senderNickname: clientMsgID.endsWith("1") ? "E2E Self" : "E2E Peer",
    senderFaceUrl: "",
    sessionType: SessionType.Single,
    contentType: MessageType.TextMessage,
    textElem: {
      content,
    },
    sendTime: Date.now() - sendTimeOffset,
  } as unknown as MessageItem);

export const createE2EPictureMessage = (clientMsgID: string, sendTimeOffset: number) =>
  ({
    clientMsgID,
    serverMsgID: clientMsgID,
    conversationID: e2eConversationID,
    sendID: "e2e_peer",
    recvID: "e2e_self",
    senderNickname: "E2E Peer",
    senderFaceUrl: "",
    sessionType: SessionType.Single,
    contentType: MessageType.PictureMessage,
    pictureElem: {
      sourcePath: "C:\\OpenIM-E2E\\fixtures\\context-image.png",
      sourcePicture: {
        uuid: "context-image.png",
        type: "image/png",
        size: 1024,
        width: 640,
        height: 360,
        url: "mock://context-image.png",
      },
      bigPicture: {
        uuid: "context-image.png",
        type: "image/png",
        size: 1024,
        width: 640,
        height: 360,
        url: "mock://context-image.png",
      },
      snapshotPicture: {
        uuid: "context-image-thumb.png",
        type: "image/png",
        size: 256,
        width: 160,
        height: 90,
        url: "mock://context-image-thumb.png",
      },
    },
    sendTime: Date.now() - sendTimeOffset,
  } as unknown as MessageItem);

export const createE2EFileMessage = (clientMsgID: string, sendTimeOffset: number) =>
  ({
    clientMsgID,
    serverMsgID: clientMsgID,
    conversationID: e2eConversationID,
    sendID: "e2e_self",
    recvID: "e2e_peer",
    senderNickname: "E2E Self",
    senderFaceUrl: "",
    sessionType: SessionType.Single,
    contentType: MessageType.FileMessage,
    fileElem: {
      filePath: "",
      uuid: "failed-download.log",
      sourceUrl: "mock://fail-download.log",
      fileName: "failed-download.log",
      fileSize: 2048,
    },
    sendTime: Date.now() - sendTimeOffset,
  } as unknown as MessageItem);

export const e2eAttachmentMessageIDs = {
  image: "e2e_msg_image",
  failedFile: "e2e_msg_failed_file",
};

export const e2eMessages = [
  createE2ETextMessage("e2e_msg_1", "hello from e2e self", 5000),
  createE2ETextMessage("e2e_msg_2", "reply from e2e peer", 4000),
  createE2ETextMessage("e2e_msg_3", "searchable history message", 3000),
  createE2EPictureMessage(e2eAttachmentMessageIDs.image, 2000),
  createE2EFileMessage(e2eAttachmentMessageIDs.failedFile, 1000),
];
