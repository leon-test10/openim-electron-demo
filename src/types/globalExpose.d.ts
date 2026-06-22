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

export interface RuntimeProfile {
  id: "opencode-local";
  title: string;
  runtime: "opencode";
  adapter: "openai-compatible-local";
  baseURL: string;
  model: string;
  apiKey: string;
  offlineBundleID: string;
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
