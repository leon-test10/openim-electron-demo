import { create } from "zustand";

import {
  RuntimeAttachment,
  RuntimeDockStore,
  RuntimeEvent,
  RuntimeInstance,
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

const appendTranscriptItem = (
  transcript: RuntimeTranscriptItem[],
  item: RuntimeTranscriptItem,
) => {
  const lastItem = transcript[transcript.length - 1];
  if (
    lastItem &&
    lastItem.role === item.role &&
    item.role !== "input" &&
    item.createdAt - lastItem.createdAt < 1000
  ) {
    return [
      ...transcript.slice(0, -1),
      {
        ...lastItem,
        content: `${lastItem.content}${item.content}`,
        createdAt: item.createdAt,
      },
    ];
  }

  return [...transcript, item];
};

const getTranscriptRoleFromEvent = (
  event: RuntimeEvent,
): RuntimeTranscriptItem["role"] => {
  switch (event.type) {
    case "stderr":
    case "error":
      return "stderr";
    case "started":
    case "exit":
    case "stopped":
      return "system";
    default:
      return "stdout";
  }
};

const toRuntimeProfileID = () => "terminal" as const;

const migrateAttachment = (attachment: RuntimeAttachment): RuntimeAttachment => {
  const legacyProfileID = attachment.runtimeProfileID as string;
  const runtimeProfileID = toRuntimeProfileID();
  const isLegacySmoke = legacyProfileID !== "terminal";

  return {
    ...attachment,
    runtimeProfileID,
    title: isLegacySmoke ? "Terminal" : attachment.title,
    status:
      attachment.status === "running" ? "stopped" : attachment.status ?? "detached",
    transcript: isLegacySmoke
      ? [
          createTranscriptItem(
            "system",
            "Migrated from the old runtime adapter. Previous transcript was cleared because this attachment is now a pure terminal host.",
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
  profileID = "terminal" as const,
  initialCommand?: string,
): RuntimeAttachment => {
  const now = Date.now();

  return {
    id: `rt_att_${now}_${Math.random().toString(36).slice(2, 8)}`,
    conversationID,
    runtimeProfileID: profileID,
    initialCommand,
    title: "Terminal",
    status: "detached",
    createdAt: now,
    transcript: [
      createTranscriptItem(
        "system",
        "Terminal attached. OpenIM only hosts the terminal; CLI runtimes manage their own sessions/config.",
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
  profileID: "terminal",
  command?: string,
) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:start", {
    attachmentID,
    conversationID,
    profileID,
    command,
  });
};

const stopRuntimeBridge = async (attachmentID: string) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:stop", attachmentID);
};

const interruptRuntimeBridge = async (attachmentID: string) => {
  if (!window.electronAPI) {
    throw new Error("Terminal runtime requires the Electron app.");
  }

  return window.electronAPI.ipcInvoke("runtime:interrupt", attachmentID);
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
  addRuntime: (conversationID, profileID = "terminal", initialCommand) => {
    if (!conversationID) return;

    const attachment = createRuntimeAttachment(
      conversationID,
      profileID,
      initialCommand,
    );
    set((state) => {
      const nextAttachments = {
        ...state.attachmentsByConversation,
        [conversationID]: [
          ...(state.attachmentsByConversation[conversationID] ?? []),
          attachment,
        ],
      };
      return saveAttachments(state, nextAttachments);
    });
    return attachment.id;
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
        "terminal",
        attachment.initialCommand,
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
  interruptRuntime: async (conversationID, attachmentID) => {
    try {
      await interruptRuntimeBridge(attachmentID);
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (attachment) => ({
            ...attachment,
            updatedAt: Date.now(),
            transcript: appendTranscriptItem(
              attachment.transcript,
              createTranscriptItem("system", "^C\r\n[interrupt sent]\r\n"),
            ),
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
            transcript: appendTranscriptItem(
              attachment.transcript,
              createTranscriptItem("system", `Interrupt failed: ${message}`),
            ),
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
            transcript: appendTranscriptItem(
              attachment.transcript,
              createTranscriptItem("system", `Input failed: ${message}`),
            ),
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    }
  },
  clearTranscript: (conversationID, attachmentID) => {
    set((state) => {
      const nextAttachments = updateAttachment(
        state.attachmentsByConversation,
        conversationID,
        attachmentID,
        (attachment) => ({
          ...attachment,
          transcript: [],
          updatedAt: Date.now(),
        }),
      );
      return saveAttachments(state, nextAttachments);
    });
  },
  handleRuntimeEvent: (event: RuntimeEvent) => {
    set((state) => {
      const role = getTranscriptRoleFromEvent(event);
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
            ? appendTranscriptItem(
                attachment.transcript,
                createTranscriptItem(role, event.data, event.timestamp),
              )
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
