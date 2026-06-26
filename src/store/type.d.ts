import {
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
import { AgentOutputEvent } from "@/services/agentOutput";
import { AgentRunContract } from "@/services/agentRunContract";
import { ContextSourceKind } from "@/services/imContext";
import {
  RuntimeEvent,
  RuntimeInstance,
  RuntimeInstanceStatus,
  RuntimeProfile,
  TerminalEvent,
  TerminalInstance,
  TerminalStatus,
} from "@/types/globalExpose";

import { MessageForwardMode } from "./messageForward";

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

export interface MessageForwardRequest {
  conversationID: string;
  messages: MessageItem[];
  mode: MessageForwardMode;
}

export interface MessageForwardStore {
  pendingRequest?: MessageForwardRequest;
  setPendingRequest: (request: MessageForwardRequest) => void;
  clearPendingRequest: () => void;
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

export interface TerminalWorkspace {
  id: string;
  title: string;
  rootPath: string;
  linkedConversationIDs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TerminalTab {
  id: string;
  workspaceID: string;
  title: string;
  shell: string;
  cwd: string;
  status: TerminalStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface TerminalCommandTemplate {
  id: string;
  title: string;
  command: string;
  description: string;
  enabled: boolean;
}

export interface TerminalOutputChunk {
  id: string;
  tabID: string;
  content: string;
  createdAt: number;
}

export type TerminalCaptureSource = "screen" | "raw" | "auto";

export interface TerminalContextBundleRecord {
  id: string;
  workspaceID: string;
  createdAt: number;
  sourceKind: ContextSourceKind;
  conversationID: string;
  messageCount: number;
  attachmentCount: number;
  exportedAttachmentCount: number;
  referencedAttachmentCount: number;
  failedAttachmentCount: number;
  unsupportedAttachmentCount: number;
  skippedAttachmentCount: number;
  approxChars: number;
  markdownPath: string;
  manifestPath: string;
  promptText: string;
}

export interface TerminalDockStore {
  panelOpen: boolean;
  workspaces: TerminalWorkspace[];
  activeWorkspaceID?: string;
  tabsByWorkspace: Record<string, TerminalTab[]>;
  activeTabByWorkspace: Record<string, string | undefined>;
  outputByTab: Record<string, TerminalOutputChunk[]>;
  lastContextPromptByWorkspace: Record<string, string | undefined>;
  contextBundlesByWorkspace: Record<string, TerminalContextBundleRecord[]>;
  commandTemplates: TerminalCommandTemplate[];
  agentPromptTemplate: string;
  autoReceiveEnabled: boolean;
  autoSendEnabled: boolean;
  autoInjectEnabled: boolean;
  autoReplyEnabled: boolean;
  captureSource: TerminalCaptureSource;
  lastCapturedTextByTab: Record<string, string | undefined>;
  structuredEventsByWorkspace: Record<string, AgentOutputEvent[]>;
  activeAgentRunByWorkspace: Record<string, AgentRunContract | undefined>;
  handledBotTriggerKeys: Record<string, true>;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  createWorkspace: (title?: string) => Promise<string | undefined>;
  setActiveWorkspace: (workspaceID: string) => void;
  linkConversationToWorkspace: (workspaceID: string, conversationID: string) => void;
  createTab: (
    workspaceID: string,
    options?: { title?: string },
  ) => Promise<string | undefined>;
  setActiveTab: (workspaceID: string, tabID: string) => void;
  startTab: (tabID: string) => Promise<void>;
  restartTab: (tabID: string) => Promise<void>;
  interruptTab: (tabID: string) => Promise<void>;
  stopTab: (tabID: string) => Promise<void>;
  writeToTab: (tabID: string, data: string) => Promise<void>;
  clearTabOutput: (tabID: string) => void;
  removeTab: (workspaceID: string, tabID: string) => Promise<void>;
  handleTerminalEvent: (event: TerminalEvent) => void;
  setLastContextPrompt: (workspaceID: string, prompt: string) => void;
  addContextBundleRecord: (
    workspaceID: string,
    record: TerminalContextBundleRecord,
  ) => void;
  clearContextBundleHistory: (workspaceID: string) => void;
  updateCommandTemplate: (
    templateID: string,
    patch: Partial<Omit<TerminalCommandTemplate, "id">>,
  ) => void;
  addCommandTemplate: () => void;
  removeCommandTemplate: (templateID: string) => void;
  resetCommandTemplates: () => void;
  setAgentPromptTemplate: (template: string) => void;
  resetAgentPromptTemplate: () => void;
  setAutoReceiveEnabled: (enabled: boolean) => void;
  setAutoSendEnabled: (enabled: boolean) => void;
  setAutoInjectEnabled: (enabled: boolean) => void;
  setAutoReplyEnabled: (enabled: boolean) => void;
  setCaptureSource: (source: TerminalCaptureSource) => void;
  setLastCapturedText: (tabID: string, text: string) => void;
  addStructuredEvent: (workspaceID: string, event: AgentOutputEvent) => void;
  clearStructuredEvents: (workspaceID: string) => void;
  setActiveAgentRun: (workspaceID: string, run?: AgentRunContract) => void;
  hasHandledBotTrigger: (key: string) => boolean;
  markBotTriggerHandled: (key: string) => void;
}

export type { TerminalEvent, TerminalInstance };
