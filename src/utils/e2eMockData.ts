import { MessageType, SessionType } from "@openim/wasm-client-sdk";
import {
  ConversationItem,
  MessageItem,
} from "@openim/wasm-client-sdk/lib/types/entity";

export const e2eConversationID = "si_e2e_user_peer";
export const e2eGroupConversationID = "sg_e2e_group";

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

export const e2eGroupConversation = {
  ...e2eConversation,
  conversationID: e2eGroupConversationID,
  conversationType: SessionType.Group,
  userID: "",
  groupID: "e2e_group",
  showName: "E2E Group",
} as ConversationItem;

export const createE2ETextMessage = (
  clientMsgID: string,
  content: string,
  sendTimeOffset: number,
  options: {
    conversationID?: string;
    sendID?: string;
    recvID?: string;
    senderNickname?: string;
    sessionType?: SessionType;
    ex?: string;
  } = {},
) =>
  ({
    clientMsgID,
    serverMsgID: clientMsgID,
    conversationID: options.conversationID ?? e2eConversationID,
    sendID: options.sendID ?? (clientMsgID.endsWith("1") ? "e2e_self" : "e2e_peer"),
    recvID: options.recvID ?? (clientMsgID.endsWith("1") ? "e2e_peer" : "e2e_self"),
    senderNickname:
      options.senderNickname ??
      (clientMsgID.endsWith("1") ? "E2E Self" : "E2E Peer"),
    senderFaceUrl: "",
    sessionType: options.sessionType ?? SessionType.Single,
    contentType: MessageType.TextMessage,
    textElem: {
      content,
    },
    sendTime: Date.now() - sendTimeOffset,
    ex: options.ex,
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

export const createE2EDangerousFileMessage = (
  clientMsgID: string,
  sendTimeOffset: number,
) =>
  ({
    clientMsgID,
    serverMsgID: clientMsgID,
    conversationID: e2eConversationID,
    sendID: "e2e_peer",
    recvID: "e2e_self",
    senderNickname: "E2E Peer",
    senderFaceUrl: "",
    sessionType: SessionType.Single,
    contentType: MessageType.FileMessage,
    fileElem: {
      filePath: "C:\\OpenIM-E2E\\fixtures\\dangerous-script.ps1",
      uuid: "dangerous-script.ps1",
      sourceUrl: "https://example.com/dangerous-script.ps1",
      fileName: "dangerous-script.ps1",
      fileSize: 512,
    },
    sendTime: Date.now() - sendTimeOffset,
  } as unknown as MessageItem);

export const e2eAttachmentMessageIDs = {
  image: "e2e_msg_image",
  failedFile: "e2e_msg_failed_file",
  dangerousFile: "e2e_msg_dangerous_file",
};

export const e2eBotMessageIDs = {
  mention: "e2e_msg_bot_mention",
  slash: "e2e_msg_bot_slash",
  selfMention: "e2e_msg_bot_self",
  agentGenerated: "e2e_msg_bot_agent_generated",
  groupMention: "e2e_group_msg_bot_mention",
};

export const e2eMessages = [
  createE2ETextMessage("e2e_msg_1", "hello from e2e self", 5000),
  createE2ETextMessage("e2e_msg_2", "reply from e2e peer", 4000),
  createE2ETextMessage("e2e_msg_3", "searchable history message", 3000),
  createE2EPictureMessage(e2eAttachmentMessageIDs.image, 2000),
  createE2EDangerousFileMessage(e2eAttachmentMessageIDs.dangerousFile, 1500),
  createE2EFileMessage(e2eAttachmentMessageIDs.failedFile, 1000),
  createE2ETextMessage(
    e2eBotMessageIDs.mention,
    "@bot @e2e_self summarize this conversation.",
    800,
  ),
  createE2ETextMessage(
    e2eBotMessageIDs.slash,
    "/bot @e2e_self explain the previous error.",
    700,
  ),
  createE2ETextMessage(e2eBotMessageIDs.selfMention, "@bot @e2e_self from myself", 600, {
    sendID: "e2e_self",
    recvID: "e2e_peer",
    senderNickname: "E2E Self",
  }),
  createE2ETextMessage(
    e2eBotMessageIDs.agentGenerated,
    "@bot @e2e_self generated loop should be ignored",
    500,
    {
      ex: JSON.stringify({
        agent: {
          generated_by: "terminal-dock-e2e",
        },
      }),
    },
  ),
];

export const e2eGroupMessages = [
  createE2ETextMessage("e2e_group_msg_1", "group context before bot", 3000, {
    conversationID: e2eGroupConversationID,
    sessionType: SessionType.Group,
  }),
  createE2ETextMessage(
    e2eBotMessageIDs.groupMention,
    "@bot @e2e_self summarize this group thread.",
    1000,
    {
      conversationID: e2eGroupConversationID,
      sessionType: SessionType.Group,
      senderNickname: "E2E Group Peer",
    },
  ),
];
