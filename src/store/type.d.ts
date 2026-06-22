import {
  AtTextElem,
  BlackUserItem,
  ConversationItem,
  FriendApplicationItem,
  FriendUserItem,
  GroupApplicationItem,
  GroupItem,
  GroupMemberItem,
  MessageItem,
} from "@openim/wasm-client-sdk/lib/types/entity";

import { BusinessUserInfo } from "@/api/login";
import {
  RuntimeEvent,
  RuntimeInstance,
  RuntimeInstanceStatus,
  RuntimeProfile,
} from "@/types/globalExpose";

export type IMConnectState = "success" | "loading" | "failed";

export interface UserStore {
  syncState: IMConnectState;
  progress: number;
  reinstall: boolean;
  isLogining: boolean;
  connectState: IMConnectState;
  selfInfo: BusinessUserInfo;
  appSettings: AppSettings;
  updateSyncState: (syncState: IMConnectState) => void;
  updateProgressState: (progress: number) => void;
  updateReinstallState: (reinstall: boolean) => void;
  updateIsLogining: (isLogining: boolean) => void;
  updateConnectState: (connectState: IMConnectState) => void;
  updateSelfInfo: (info: Partial<BusinessUserInfo>) => void;
  getSelfInfoByReq: () => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  userLogout: (force?: boolean) => Promise<void>;
}

export interface AppSettings {
  locale: LocaleString;
  closeAction: "miniSize" | "quit";
}

export type LocaleString = "zh-CN" | "en-US";

export type ConversationListUpdateType = "push" | "filter";

export interface ConversationStore {
  conversationList: ConversationItem[];
  currentConversation?: ConversationItem;
  unReadCount: number;
  currentGroupInfo?: GroupItem;
  currentMemberInGroup?: GroupMemberItem;
  getConversationListByReq: (isOffset?: boolean) => Promise<boolean>;
  updateConversationList: (
    list: ConversationItem[],
    type: ConversationListUpdateType,
  ) => void;
  updateCurrentConversation: (
    conversation?: ConversationItem,
    isJump?: boolean,
  ) => Promise<void>;
  getUnReadCountByReq: () => Promise<number>;
  updateUnReadCount: (count: number) => void;
  getCurrentGroupInfoByReq: (groupID: string) => Promise<void>;
  updateCurrentGroupInfo: (groupInfo: GroupItem) => void;
  getCurrentMemberInGroupByReq: (groupID: string) => Promise<void>;
  setCurrentMemberInGroup: (memberInfo?: GroupMemberItem) => void;
  tryUpdateCurrentMemberInGroup: (member: GroupMemberItem) => void;
  clearConversationStore: () => void;
}

export interface ContactStore {
  friendList: FriendUserItem[];
  blackList: BlackUserItem[];
  groupList: GroupItem[];
  recvFriendApplicationList: FriendApplicationItem[];
  sendFriendApplicationList: FriendApplicationItem[];
  recvGroupApplicationList: GroupApplicationItem[];
  sendGroupApplicationList: GroupApplicationItem[];
  unHandleFriendApplicationCount: number;
  unHandleGroupApplicationCount: number;
  getFriendListByReq: () => Promise<void>;
  setFriendList: (list: FriendUserItem[]) => void;
  updateFriend: (friend: FriendUserItem, remove?: boolean) => void;
  pushNewFriend: (friend: FriendUserItem) => void;
  getBlackListByReq: () => Promise<void>;
  updateBlack: (black: BlackUserItem, remove?: boolean) => void;
  pushNewBlack: (black: BlackUserItem) => void;
  getGroupListByReq: () => Promise<void>;
  setGroupList: (list: GroupItem[]) => void;
  updateGroup: (group: GroupItem, remove?: boolean) => void;
  pushNewGroup: (group: GroupItem) => void;
  getRecvFriendApplicationListByReq: () => Promise<void>;
  updateRecvFriendApplication: (application: FriendApplicationItem) => void;
  getSendFriendApplicationListByReq: () => Promise<void>;
  updateSendFriendApplication: (application: FriendApplicationItem) => void;
  getRecvGroupApplicationListByReq: () => Promise<void>;
  updateRecvGroupApplication: (application: GroupApplicationItem) => void;
  getSendGroupApplicationListByReq: () => Promise<void>;
  updateSendGroupApplication: (application: GroupApplicationItem) => void;
  updateUnHandleFriendApplicationCount: (num: number) => void;
  updateUnHandleGroupApplicationCount: (num: number) => void;
  clearContactStore: () => void;
}

export type RuntimeAttachmentStatus = RuntimeInstanceStatus;

export type RuntimeProfileID = RuntimeProfile["id"];

export interface RuntimeTranscriptItem {
  id: string;
  role: "input" | "stdout" | "stderr" | "system";
  content: string;
  createdAt: number;
}

export interface RuntimeAttachment {
  id: string;
  conversationID: string;
  runtimeProfileID: RuntimeProfileID;
  initialCommand?: string;
  title: string;
  status: RuntimeAttachmentStatus;
  createdAt: number;
  updatedAt?: number;
  lastError?: string;
  transcript: RuntimeTranscriptItem[];
}

export interface RuntimeDockStore {
  panelOpen: boolean;
  attachmentsByConversation: Record<string, RuntimeAttachment[]>;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  addRuntime: (
    conversationID: string,
    profileID?: RuntimeProfileID,
    initialCommand?: string,
  ) => string | undefined;
  startRuntime: (conversationID: string, attachmentID: string) => Promise<void>;
  interruptRuntime: (conversationID: string, attachmentID: string) => Promise<void>;
  stopRuntime: (conversationID: string, attachmentID: string) => Promise<void>;
  writeInput: (
    conversationID: string,
    attachmentID: string,
    input: string,
  ) => Promise<void>;
  clearTranscript: (conversationID: string, attachmentID: string) => void;
  handleRuntimeEvent: (event: RuntimeEvent) => void;
  removeAttachment: (conversationID: string, attachmentID: string) => void;
}

export type { RuntimeEvent, RuntimeInstance, RuntimeProfile };
