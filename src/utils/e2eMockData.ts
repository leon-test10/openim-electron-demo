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

export const e2eMessages = [
  createE2ETextMessage("e2e_msg_1", "hello from e2e self", 3000),
  createE2ETextMessage("e2e_msg_2", "reply from e2e peer", 2000),
  createE2ETextMessage("e2e_msg_3", "searchable history message", 1000),
];
