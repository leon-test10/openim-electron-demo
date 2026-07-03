import { MessageStatus, MessageType, SessionType } from "@openim/wasm-client-sdk";
import {
  ConversationItem,
  FriendUserItem,
  MessageItem,
} from "@openim/wasm-client-sdk/lib/types/entity";
import * as localForage from "localforage";

import type { BusinessUserInfo } from "../../api/login";

export const OFFLINE_SELF_USER_ID = "offline_self";
export const OFFLINE_SELF_NICKNAME = "Offline User";

export type OfflineMessageSender = "self" | "peer";

export interface OfflineFriend {
  userID: string;
  nickname: string;
  remark?: string;
  faceURL: string;
  createdAt: number;
  updatedAt: number;
}

export interface OfflineFriendship {
  ownerUserID: string;
  friendUserID: string;
  createdAt: number;
}

export type OfflineConversation = ConversationItem & {
  offlinePeerUserID: string;
  createdAt: number;
  updatedAt: number;
};

export type OfflineMessage = MessageItem & {
  offline: true;
};

interface OfflineIMState {
  friends: OfflineFriend[];
  friendships: OfflineFriendship[];
  conversations: OfflineConversation[];
  messagesByConversation: Record<string, OfflineMessage[]>;
}

export interface OfflineIMStorage {
  read: () => Promise<OfflineIMState | undefined>;
  write: (state: OfflineIMState) => Promise<void>;
  clear: () => Promise<void>;
}

export interface OfflineIMServiceOptions {
  storage: OfflineIMStorage;
  now?: () => number;
}

const createInitialState = (): OfflineIMState => ({
  friends: [],
  friendships: [],
  conversations: [],
  messagesByConversation: {},
});

const byUpdatedDesc = (a: { updatedAt?: number }, b: { updatedAt?: number }) =>
  (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

const createID = (prefix: string, now: number) =>
  `${prefix}_${now}_${Math.random().toString(36).slice(2, 8)}`;

const buildOfflineConversationID = (friendUserID: string) =>
  `offline_si_${OFFLINE_SELF_USER_ID}_${friendUserID}`;

export const createMemoryOfflineIMStorage = (): OfflineIMStorage => {
  let state: OfflineIMState | undefined;

  return {
    read: () => Promise.resolve(state ? structuredClone(state) : undefined),
    write: (nextState) => {
      state = structuredClone(nextState);
      return Promise.resolve();
    },
    clear: () => {
      state = undefined;
      return Promise.resolve();
    },
  };
};

export const createLocalForageOfflineIMStorage = (
  key = "OFFLINE_IM_STATE",
): OfflineIMStorage => ({
  read: async () =>
    ((await localForage.getItem(key)) as OfflineIMState | undefined) ?? undefined,
  write: async (state) => {
    await localForage.setItem(key, state);
  },
  clear: async () => {
    await localForage.removeItem(key);
  },
});

export const createOfflineSelfInfo = (): BusinessUserInfo => ({
  userID: OFFLINE_SELF_USER_ID,
  password: "",
  account: OFFLINE_SELF_USER_ID,
  phoneNumber: "",
  areaCode: "",
  email: "",
  nickname: OFFLINE_SELF_NICKNAME,
  faceURL: "",
  gender: 0,
  level: 0,
  birth: 0,
  allowAddFriend: 1,
  allowBeep: 1,
  allowVibration: 1,
  globalRecvMsgOpt: 0,
});

export const offlineFriendToFriendUserItem = (friend: OfflineFriend): FriendUserItem =>
  ({
    userID: friend.userID,
    nickname: friend.nickname,
    remark: friend.remark ?? "",
    faceURL: friend.faceURL,
    createTime: friend.createdAt,
    addSource: 0,
    operatorUserID: OFFLINE_SELF_USER_ID,
    ownerUserID: OFFLINE_SELF_USER_ID,
    ex: JSON.stringify({ offline: true }),
  } as unknown as FriendUserItem);

export class OfflineIMService {
  private readonly storage: OfflineIMStorage;
  private readonly now: () => number;

  constructor(options: OfflineIMServiceOptions) {
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
  }

  async reset() {
    await this.storage.clear();
  }

  async createVirtualFriend(params: {
    nickname: string;
    remark?: string;
    faceURL?: string;
  }) {
    const state = await this.readState();
    const now = this.now();
    const friend: OfflineFriend = {
      userID: createID("offline_friend", now),
      nickname: params.nickname.trim() || "Virtual Friend",
      remark: params.remark?.trim() || undefined,
      faceURL: params.faceURL ?? "",
      createdAt: now,
      updatedAt: now,
    };

    const nextState: OfflineIMState = {
      ...state,
      friends: [...state.friends, friend],
      friendships: [
        ...state.friendships,
        {
          ownerUserID: OFFLINE_SELF_USER_ID,
          friendUserID: friend.userID,
          createdAt: now,
        },
        {
          ownerUserID: friend.userID,
          friendUserID: OFFLINE_SELF_USER_ID,
          createdAt: now,
        },
      ],
    };
    const conversation = this.ensureConversation(nextState, friend, now);

    await this.storage.write(nextState);

    return {
      friend,
      conversation,
    };
  }

  async listFriendships() {
    const state = await this.readState();
    return [...state.friendships];
  }

  async listFriends() {
    const state = await this.readState();
    return [...state.friends].sort(byUpdatedDesc);
  }

  async listConversations() {
    const state = await this.readState();
    return [...state.conversations].sort(byUpdatedDesc);
  }

  async createTextMessage(params: {
    conversationID: string;
    sender: OfflineMessageSender;
    content: string;
  }) {
    const state = await this.readState();
    const conversation = state.conversations.find(
      (item) => item.conversationID === params.conversationID,
    );
    if (!conversation) {
      throw new Error("Offline conversation not found");
    }

    const friend = state.friends.find(
      (item) => item.userID === conversation.offlinePeerUserID,
    );
    if (!friend) {
      throw new Error("Offline friend not found");
    }

    const now = this.now();
    const isSelf = params.sender === "self";
    const message = {
      clientMsgID: createID("offline_msg", now),
      serverMsgID: "",
      conversationID: conversation.conversationID,
      sendID: isSelf ? OFFLINE_SELF_USER_ID : friend.userID,
      recvID: isSelf ? friend.userID : OFFLINE_SELF_USER_ID,
      senderNickname: isSelf ? OFFLINE_SELF_NICKNAME : friend.nickname,
      senderFaceUrl: isSelf ? "" : friend.faceURL,
      sessionType: SessionType.Single,
      contentType: MessageType.TextMessage,
      textElem: {
        content: params.content,
      },
      sendTime: now,
      createTime: now,
      status: MessageStatus.Succeed,
      offline: true,
    } as unknown as OfflineMessage;

    const messages = state.messagesByConversation[conversation.conversationID] ?? [];
    state.messagesByConversation = {
      ...state.messagesByConversation,
      [conversation.conversationID]: [...messages, message],
    };
    state.conversations = state.conversations.map((item) =>
      item.conversationID === conversation.conversationID
        ? {
            ...item,
            latestMsg: JSON.stringify(message),
            latestMsgSendTime: now,
            updatedAt: now,
          }
        : item,
    );

    await this.storage.write(state);

    return message;
  }

  async listMessages(params: {
    conversationID: string;
    count: number;
    startClientMsgID?: string;
  }) {
    const state = await this.readState();
    const messages = state.messagesByConversation[params.conversationID] ?? [];
    const count = Math.max(params.count, 1);

    if (!params.startClientMsgID) {
      return {
        messageList: messages.slice(-count),
        isEnd: messages.length <= count,
      };
    }

    const startIndex = messages.findIndex(
      (item) => item.clientMsgID === params.startClientMsgID,
    );
    const end = startIndex < 0 ? messages.length : startIndex;
    const start = Math.max(end - count, 0);

    return {
      messageList: messages.slice(start, end),
      isEnd: start === 0,
    };
  }

  private ensureConversation(
    state: OfflineIMState,
    friend: OfflineFriend,
    now: number,
  ) {
    const conversationID = buildOfflineConversationID(friend.userID);
    const existing = state.conversations.find(
      (item) => item.conversationID === conversationID,
    );
    if (existing) return existing;

    const conversation = {
      conversationID,
      conversationType: SessionType.Single,
      userID: friend.userID,
      showName: friend.nickname,
      faceURL: friend.faceURL,
      recvMsgOpt: 0,
      unreadCount: 0,
      groupID: "",
      latestMsg: "",
      latestMsgSendTime: now,
      draftText: "",
      isPinned: false,
      isPrivateChat: false,
      burnDuration: 0,
      attachedInfo: "",
      ex: JSON.stringify({
        offline: true,
      }),
      offlinePeerUserID: friend.userID,
      createdAt: now,
      updatedAt: now,
    } as unknown as OfflineConversation;

    state.conversations = [...state.conversations, conversation];
    state.messagesByConversation[conversationID] =
      state.messagesByConversation[conversationID] ?? [];
    return conversation;
  }

  private async readState() {
    return (await this.storage.read()) ?? createInitialState();
  }
}

export const offlineIMService = new OfflineIMService({
  storage: createLocalForageOfflineIMStorage(),
});
