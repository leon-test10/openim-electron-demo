import { MessageItem } from "@openim/wasm-client-sdk";
import { create } from "zustand";

export type MessageForwardMode = "single" | "merged";

export interface MessageForwardRequest {
  conversationID: string;
  messages: MessageItem[];
  mode: MessageForwardMode;
}

interface MessageForwardStore {
  pendingRequest?: MessageForwardRequest;
  setPendingRequest: (request: MessageForwardRequest) => void;
  clearPendingRequest: () => void;
}

export const useMessageForwardStore = create<MessageForwardStore>()((set) => ({
  pendingRequest: undefined,
  setPendingRequest: (request) =>
    set(() => ({
      pendingRequest: request,
    })),
  clearPendingRequest: () =>
    set(() => ({
      pendingRequest: undefined,
    })),
}));
