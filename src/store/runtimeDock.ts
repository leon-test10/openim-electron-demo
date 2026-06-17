import { create } from "zustand";

import { RuntimeAttachment, RuntimeDockStore } from "./type";

export type { RuntimeAttachment } from "./type";

const STORAGE_KEY = "openim_runtime_dock_state";

type StoredRuntimeDockState = Pick<
  RuntimeDockStore,
  "panelOpen" | "attachmentsByConversation"
>;

const defaultState: StoredRuntimeDockState = {
  panelOpen: false,
  attachmentsByConversation: {},
};

const canUseLocalStorage = () => typeof window !== "undefined" && window.localStorage;

const readStoredState = (): StoredRuntimeDockState => {
  if (!canUseLocalStorage()) return defaultState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<StoredRuntimeDockState>;

    return {
      panelOpen:
        typeof parsed.panelOpen === "boolean"
          ? parsed.panelOpen
          : defaultState.panelOpen,
      attachmentsByConversation:
        parsed.attachmentsByConversation &&
        typeof parsed.attachmentsByConversation === "object"
          ? parsed.attachmentsByConversation
          : defaultState.attachmentsByConversation,
    };
  } catch {
    return defaultState;
  }
};

const persistState = (state: StoredRuntimeDockState) => {
  if (!canUseLocalStorage()) return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const createPlaceholderAttachment = (conversationID: string): RuntimeAttachment => ({
  id: `rt_att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  conversationID,
  runtimeProfileID: "shell-placeholder",
  title: "Shell Placeholder",
  status: "detached",
  createdAt: Date.now(),
});

export const useRuntimeDockStore = create<RuntimeDockStore>()((set) => ({
  ...readStoredState(),
  togglePanel: () => {
    set((state) => {
      const nextState = {
        panelOpen: !state.panelOpen,
        attachmentsByConversation: state.attachmentsByConversation,
      };
      persistState(nextState);
      return { panelOpen: nextState.panelOpen };
    });
  },
  setPanelOpen: (open) => {
    set((state) => {
      const nextState = {
        panelOpen: open,
        attachmentsByConversation: state.attachmentsByConversation,
      };
      persistState(nextState);
      return { panelOpen: open };
    });
  },
  addPlaceholderRuntime: (conversationID) => {
    if (!conversationID) return;

    set((state) => {
      const nextAttachments = {
        ...state.attachmentsByConversation,
        [conversationID]: [
          ...(state.attachmentsByConversation[conversationID] ?? []),
          createPlaceholderAttachment(conversationID),
        ],
      };
      persistState({
        panelOpen: state.panelOpen,
        attachmentsByConversation: nextAttachments,
      });
      return { attachmentsByConversation: nextAttachments };
    });
  },
  removeAttachment: (conversationID, attachmentID) => {
    set((state) => {
      const nextAttachments = {
        ...state.attachmentsByConversation,
        [conversationID]: (
          state.attachmentsByConversation[conversationID] ?? []
        ).filter((attachment) => attachment.id !== attachmentID),
      };
      persistState({
        panelOpen: state.panelOpen,
        attachmentsByConversation: nextAttachments,
      });
      return { attachmentsByConversation: nextAttachments };
    });
  },
}));

export const getRuntimeDockAttachments = (conversationID?: string) => {
  if (!conversationID) return [];
  return useRuntimeDockStore.getState().attachmentsByConversation[conversationID] ?? [];
};
