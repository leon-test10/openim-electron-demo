import { MessageItem } from "@openim/wasm-client-sdk";
import { create } from "zustand";

export interface MessageSelectionStore {
  activeConversationID?: string;
  selectedMessagesByConversation: Record<string, Record<string, MessageItem>>;
  selectionAnchorMessageIDByConversation: Record<string, string | undefined>;
  setSelectionMode: (
    conversationID: string | undefined,
    active: boolean,
    anchorMessageID?: string,
  ) => void;
  setSelectionAnchor: (conversationID: string, anchorMessageID?: string) => void;
  toggleMessageSelection: (conversationID: string, message: MessageItem) => void;
  addMessageSelection: (conversationID: string, message: MessageItem) => void;
  selectOnlyMessage: (conversationID: string, message: MessageItem) => void;
  clearSelection: (conversationID?: string) => void;
}

export const useMessageSelectionStore = create<MessageSelectionStore>()((set) => ({
  activeConversationID: undefined,
  selectedMessagesByConversation: {},
  selectionAnchorMessageIDByConversation: {},
  setSelectionMode: (conversationID, active, anchorMessageID) => {
    set((state) => ({
      activeConversationID: active ? conversationID : undefined,
      selectedMessagesByConversation:
        active || !conversationID
          ? state.selectedMessagesByConversation
          : {
              ...state.selectedMessagesByConversation,
              [conversationID]: {},
            },
      selectionAnchorMessageIDByConversation:
        active || !conversationID
          ? {
              ...state.selectionAnchorMessageIDByConversation,
              ...(conversationID ? { [conversationID]: anchorMessageID } : undefined),
            }
          : {
              ...state.selectionAnchorMessageIDByConversation,
              [conversationID]: undefined,
            },
    }));
  },
  setSelectionAnchor: (conversationID, anchorMessageID) => {
    set((state) => ({
      selectionAnchorMessageIDByConversation: {
        ...state.selectionAnchorMessageIDByConversation,
        [conversationID]: anchorMessageID,
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
      selectionAnchorMessageIDByConversation: {
        ...state.selectionAnchorMessageIDByConversation,
        [conversationID]:
          state.selectionAnchorMessageIDByConversation[conversationID] ??
          message.clientMsgID,
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
      selectionAnchorMessageIDByConversation: {
        ...state.selectionAnchorMessageIDByConversation,
        [conversationID]: message.clientMsgID,
      },
    }));
  },
  clearSelection: (conversationID) => {
    set((state) => {
      if (!conversationID) {
        return {
          activeConversationID: undefined,
          selectedMessagesByConversation: {},
          selectionAnchorMessageIDByConversation: {},
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
        selectionAnchorMessageIDByConversation: {
          ...state.selectionAnchorMessageIDByConversation,
          [conversationID]: undefined,
        },
      };
    });
  },
}));
