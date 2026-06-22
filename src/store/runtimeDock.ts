import { create } from "zustand";

import {
  RuntimeAttachment,
  RuntimeDockStore,
  RuntimeEvent,
  RuntimeInstance,
  RuntimeProfileID,
  RuntimeTranscriptItem,
} from "./type";

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

const createTranscriptItem = (
  role: RuntimeTranscriptItem["role"],
  content: string,
  createdAt = Date.now(),
): RuntimeTranscriptItem => ({
  id: `rt_log_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt,
});

const toRuntimeProfileID = (profileID?: string): RuntimeProfileID => {
  if (profileID === "opencode-terminal") return "opencode-terminal";
  return "powershell-terminal";
};

const migrateAttachment = (attachment: RuntimeAttachment): RuntimeAttachment => {
  const legacyProfileID = attachment.runtimeProfileID as string;
  const runtimeProfileID = toRuntimeProfileID(legacyProfileID);
  const isLegacySmoke =
    legacyProfileID === "opencode-local" || legacyProfileID === "shell-placeholder";

  return {
    ...attachment,
    runtimeProfileID,
    title: isLegacySmoke ? "PowerShell Terminal" : attachment.title,
    status:
      attachment.status === "running" ? "stopped" : attachment.status ?? "detached",
    transcript: isLegacySmoke
      ? [
          createTranscriptItem(
            "system",
            "Migrated from the old local-model smoke adapter. Previous model-chat transcript was cleared because this attachment is now a terminal host.",
            Date.now(),
          ),
        ]
      : attachment.transcript ?? [],
  };
};

const migrateAttachmentsByConversation = (
  value: StoredRuntimeDockState["attachmentsByConversation"],
) => {
  return Object.fromEntries(
    Object.entries(value).map(([conversationID, attachments]) => [
      conversationID,
      attachments.map(migrateAttachment),
    ]),
  );
};

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
          ? migrateAttachmentsByConversation(parsed.attachmentsByConversation)
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

const createRuntimeAttachment = (
  conversationID: string,
  profileID: RuntimeProfileID = "powershell-terminal",
): RuntimeAttachment => {
  const now = Date.now();
  const isOpencode = profileID === "opencode-terminal";

  return {
    id: `rt_att_${now}_${Math.random().toString(36).slice(2, 8)}`,
    conversationID,
    runtimeProfileID: profileID,
    title: isOpencode ? "opencode Terminal" : "PowerShell Terminal",
    status: "detached",
    createdAt: now,
    transcript: [
      createTranscriptItem(
        "system",
        isOpencode
          ? "opencode terminal attached. Runtime config is owned by opencode; IM only hosts the terminal."
          : "PowerShell terminal attached. Runtime CLIs manage their own config.",
        now,
      ),
    ],
  };
};

const updateAttachment = (
  attachmentsByConversation: RuntimeDockStore["attachmentsByConversation"],
  conversationID: string,
  attachmentID: string,
  updater: (attachment: RuntimeAttachment) => RuntimeAttachment,
) => ({
  ...attachmentsByConversation,
  [conversationID]: (attachmentsByConversation[conversationID] ?? []).map(
    (attachment) => (attachment.id === attachmentID ? updater(attachment) : attachment),
  ),
});

const updateAttachmentByID = (
  attachmentsByConversation: RuntimeDockStore["attachmentsByConversation"],
  attachmentID: string,
  updater: (attachment: RuntimeAttachment) => RuntimeAttachment,
) => {
  let found = false;
  const nextAttachments = Object.fromEntries(
    Object.entries(attachmentsByConversation).map(([conversationID, attachments]) => [
      conversationID,
      attachments.map((attachment) => {
        if (attachment.id !== attachmentID) return attachment;
        found = true;
        return updater(attachment);
      }),
    ]),
  );

  return found ? nextAttachments : attachmentsByConversation;
};

const saveAttachments = (
  state: StoredRuntimeDockState,
  attachmentsByConversation: RuntimeDockStore["attachmentsByConversation"],
) => {
  persistState({
    panelOpen: state.panelOpen,
    attachmentsByConversation,
  });
  return { attachmentsByConversation };
};

const startRuntimeBridge = async (
  attachmentID: string,
  conversationID: string,
  profileID: RuntimeProfileID,
) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:start", {
    attachmentID,
    conversationID,
    profileID,
  });
};

const stopRuntimeBridge = async (attachmentID: string) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:stop", attachmentID);
};

const writeRuntimeInputBridge = async (attachmentID: string, input: string) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke("runtime:writeInput", {
    attachmentID,
    input,
  });
};

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
  addRuntime: (conversationID, profileID = "powershell-terminal") => {
    if (!conversationID) return;

    set((state) => {
      const nextAttachments = {
        ...state.attachmentsByConversation,
        [conversationID]: [
          ...(state.attachmentsByConversation[conversationID] ?? []),
          createRuntimeAttachment(conversationID, profileID),
        ],
      };
      return saveAttachments(state, nextAttachments);
    });
  },
  startRuntime: async (conversationID, attachmentID) => {
    set((state) => {
      const nextAttachments = updateAttachment(
        state.attachmentsByConversation,
        conversationID,
        attachmentID,
        (attachment) => ({
          ...attachment,
          status: "starting",
          lastError: undefined,
          updatedAt: Date.now(),
        }),
      );
      return saveAttachments(state, nextAttachments);
    });

    const attachment = useRuntimeDockStore
      .getState()
      .attachmentsByConversation[conversationID]?.find(
        (item) => item.id === attachmentID,
      );
    if (!attachment) return;

    try {
      const instance = await startRuntimeBridge(
        attachmentID,
        conversationID,
        attachment.runtimeProfileID,
      );
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (item) => ({
            ...item,
            status: instance?.status ?? "running",
            lastError: instance?.lastError,
            updatedAt: Date.now(),
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (item) => ({
            ...item,
            status: "error",
            lastError: message,
            updatedAt: Date.now(),
            transcript: [
              ...item.transcript,
              createTranscriptItem("system", `Runtime failed: ${message}`),
            ],
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    }
  },
  stopRuntime: async (conversationID, attachmentID) => {
    try {
      const instance = await stopRuntimeBridge(attachmentID);

      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (attachment) => ({
            ...attachment,
            status: instance?.status ?? "stopped",
            updatedAt: Date.now(),
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (attachment) => ({
            ...attachment,
            status: "error",
            lastError: message,
            updatedAt: Date.now(),
            transcript: [
              ...attachment.transcript,
              createTranscriptItem("system", `Stop failed: ${message}`),
            ],
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    }
  },
  writeInput: async (conversationID, attachmentID, input) => {
    if (!input) return;

    set((state) => {
      const nextAttachments = updateAttachment(
        state.attachmentsByConversation,
        conversationID,
        attachmentID,
        (attachment) => ({
          ...attachment,
          transcript: [...attachment.transcript, createTranscriptItem("input", input)],
        }),
      );
      return saveAttachments(state, nextAttachments);
    });

    try {
      await writeRuntimeInputBridge(attachmentID, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (attachment) => ({
            ...attachment,
            status: "error",
            lastError: message,
            updatedAt: Date.now(),
            transcript: [
              ...attachment.transcript,
              createTranscriptItem("system", `Input failed: ${message}`),
            ],
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    }
  },
  handleRuntimeEvent: (event: RuntimeEvent) => {
    set((state) => {
      const role =
        event.type === "stderr" || event.type === "error" ? "stderr" : "stdout";
      const nextAttachments = updateAttachmentByID(
        state.attachmentsByConversation,
        event.attachmentID,
        (attachment) => ({
          ...attachment,
          status:
            event.type === "exit" || event.type === "stopped"
              ? "stopped"
              : event.type === "error"
              ? "error"
              : event.type === "started"
              ? "running"
              : attachment.status,
          updatedAt: event.timestamp,
          lastError: event.type === "error" ? event.data : attachment.lastError,
          transcript: event.data
            ? [
                ...attachment.transcript,
                createTranscriptItem(role, event.data, event.timestamp),
              ]
            : attachment.transcript,
        }),
      );
      return saveAttachments(state, nextAttachments);
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
      return saveAttachments(state, nextAttachments);
    });
  },
}));

export const getRuntimeDockAttachments = (conversationID?: string) => {
  if (!conversationID) return [];
  return useRuntimeDockStore.getState().attachmentsByConversation[conversationID] ?? [];
};
