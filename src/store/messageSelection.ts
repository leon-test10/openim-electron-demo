import { MessageItem } from "@openim/wasm-client-sdk";
import { create } from "zustand";

export interface MessageSelectionStore {
  activeConversationID?: string;
  selectedMessagesByConversation: Record<string, Record<string, MessageItem>>;
  setSelectionMode: (conversationID: string | undefined, active: boolean) => void;
  toggleMessageSelection: (conversationID: string, message: MessageItem) => void;
  addMessageSelection: (conversationID: string, message: MessageItem) => void;
  selectOnlyMessage: (conversationID: string, message: MessageItem) => void;
  clearSelection: (conversationID?: string) => void;
}

export const useMessageSelectionStore = create<MessageSelectionStore>()((set) => ({
  activeConversationID: undefined,
  selectedMessagesByConversation: {},
  setSelectionMode: (conversationID, active) => {
    set((state) => ({
      activeConversationID: active ? conversationID : undefined,
      selectedMessagesByConversation:
        active || !conversationID
          ? state.selectedMessagesByConversation
          : {
              ...state.selectedMessagesByConversation,
              [conversationID]: {},
            },
    }));
  },
  toggleMessageSelection: (conversationID, message) => {
    set((state) => {
      const current = state.selectedMessagesByConversation[conversationID] ?? {};
      const next = { ...current };

      if (next[message.clientMsgID]) {
        delete next[message.clientMsgID];
      } else {
        next[message.clientMsgID] = message;
      }

      return {
        selectedMessagesByConversation: {
          ...state.selectedMessagesByConversation,
          [conversationID]: next,
        },
      };
    });
  },
  addMessageSelection: (conversationID, message) => {
    set((state) => ({
      activeConversationID: conversationID,
      selectedMessagesByConversation: {
        ...state.selectedMessagesByConversation,
        [conversationID]: {
          ...(state.selectedMessagesByConversation[conversationID] ?? {}),
          [message.clientMsgID]: message,
        },
      },
    }));
  },
  selectOnlyMessage: (conversationID, message) => {
    set((state) => ({
      activeConversationID: conversationID,
      selectedMessagesByConversation: {
        ...state.selectedMessagesByConversation,
        [conversationID]: {
          [message.clientMsgID]: message,
        },
      },
    }));
  },
  clearSelection: (conversationID) => {
    set((state) => {
      if (!conversationID) {
        return {
          activeConversationID: undefined,
          selectedMessagesByConversation: {},
        };
      }

      return {
        activeConversationID:
          state.activeConversationID === conversationID
            ? undefined
            : state.activeConversationID,
        selectedMessagesByConversation: {
          ...state.selectedMessagesByConversation,
          [conversationID]: {},
        },
      };
    });
  },
}));
