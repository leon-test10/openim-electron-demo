import { Platform } from "@openim/wasm-client-sdk";

export type DataPath = "public" | "emojiData" | "sdkResources" | "logsPath";

export interface IElectronAPI {
  getDataPath: (key: DataPath) => string;
  getVersion: () => string;
  getPlatform: () => Platform;
  getSystemVersion: () => string;
  subscribe: (channel: string, callback: (...args: any[]) => void) => () => void;
  subscribeOnce: (channel: string, callback: (...args: any[]) => void) => void;
  unsubscribeAll: (channel: string) => void;
  ipcInvoke: <T = unknown>(channel: string, ...arg: any) => Promise<T>;
  ipcSendSync: <T = unknown>(channel: string, ...arg: any) => T;
  saveFileToDisk: (params: { file: File; sync?: boolean }) => Promise<string>;
  getFileByPath: (filePath: string) => Promise<File | null>;
}

export type RuntimeInstanceStatus =
  | "detached"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export type RuntimeEventType =
  | "started"
  | "stdout"
  | "stderr"
  | "exit"
  | "error"
  | "stopped";

export interface RuntimeProfile {
  id: "terminal";
  title: string;
  runtime: "terminal";
  shell: string;
  args: string[];
  cwd: string;
  startupCommand?: string;
  env: Record<string, string>;
  description: string;
}

export interface RuntimeInstance {
  id: string;
  conversationID: string;
  profileID: RuntimeProfile["id"];
  status: RuntimeInstanceStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface RuntimePromptResult {
  attachmentID: string;
  output: string;
  completedAt: number;
}

export interface RuntimeEvent {
  attachmentID: string;
  type: RuntimeEventType;
  data?: string;
  exitCode?: number | null;
  signal?: string | null;
  timestamp: number;
}

export interface RuntimeResizeParams {
  attachmentID: string;
  cols: number;
  rows: number;
}

export type TerminalStatus = "detached" | "starting" | "running" | "error" | "stopped";

export type TerminalEventType = "started" | "stdout" | "exit" | "error" | "stopped";

export interface TerminalInstance {
  id: string;
  workspaceID: string;
  cwd: string;
  shell: string;
  status: TerminalStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface TerminalEvent {
  tabID: string;
  type: TerminalEventType;
  data?: string;
  exitCode?: number | null;
  signal?: string | null;
  timestamp: number;
}

export interface TerminalResizeParams {
  tabID: string;
  cols: number;
  rows: number;
}

declare global {
  interface Window {
    electronAPI?: IElectronAPI;
    userClick: (userID?: string, groupID?: string) => void;
    editRevoke: (clientMsgID: string) => void;
    screenshotPreview: (results: string) => void;
  }
}

declare module "i18next" {
  interface TFunction {
    (key: string, options?: object): string;
  }
}
