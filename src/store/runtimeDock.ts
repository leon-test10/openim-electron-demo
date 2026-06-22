import { create } from "zustand";

import {
  RuntimeAttachment,
  RuntimeDockStore,
  RuntimeInstance,
  RuntimeProfileID,
  RuntimePromptResult,
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
): RuntimeTranscriptItem => ({
  id: `rt_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: Date.now(),
});

const migrateAttachment = (attachment: RuntimeAttachment): RuntimeAttachment => {
  const legacyProfileID = attachment.runtimeProfileID as string;
  const isLegacyPlaceholder = legacyProfileID === "shell-placeholder";

  return {
    ...attachment,
    runtimeProfileID: isLegacyPlaceholder
      ? "opencode-local"
      : attachment.runtimeProfileID,
    title: isLegacyPlaceholder ? "opencode-local" : attachment.title,
    status: attachment.status ?? "detached",
    transcript: attachment.transcript ?? [],
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
  profileID: RuntimeProfileID = "opencode-local",
): RuntimeAttachment => {
  const now = Date.now();

  return {
    id: `rt_att_${now}_${Math.random().toString(36).slice(2, 8)}`,
    conversationID,
    runtimeProfileID: profileID,
    title: "opencode-local",
    status: "detached",
    createdAt: now,
    transcript: [
      {
        id: `rt_log_${now}_system`,
        role: "system",
        content:
          "opencode-local profile is attached. Start it to test the local model runtime bridge.",
        createdAt: now,
      },
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

const localModelRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/runtime-local/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer local",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
};

const startRuntimeBridge = async (
  attachmentID: string,
  conversationID: string,
  profileID: RuntimeProfileID,
) => {
  if (window.electronAPI) {
    return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:start", {
      attachmentID,
      conversationID,
      profileID,
    });
  }

  await localModelRequest("/models", { method: "GET" });
  return {
    id: attachmentID,
    conversationID,
    profileID,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } satisfies RuntimeInstance;
};

const stopRuntimeBridge = async (
  attachmentID: string,
  conversationID: string,
  profileID: RuntimeProfileID,
) => {
  if (window.electronAPI) {
    return window.electronAPI.ipcInvoke<RuntimeInstance>("runtime:stop", attachmentID);
  }

  return {
    id: attachmentID,
    conversationID,
    profileID,
    status: "stopped",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } satisfies RuntimeInstance;
};

const sendRuntimePromptBridge = async (
  attachmentID: string,
  prompt: string,
): Promise<RuntimePromptResult> => {
  if (window.electronAPI) {
    return window.electronAPI.ipcInvoke<RuntimePromptResult>("runtime:sendPrompt", {
      attachmentID,
      prompt,
    });
  }

  const response = await localModelRequest<{
    choices?: Array<{ message?: { content?: string } }>;
  }>("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
      messages: [
        {
          role: "system",
          content:
            "You are the opencode-local runtime smoke adapter inside OpenIM. Reply concisely.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 512,
    }),
  });

  const output = response.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("Runtime returned an empty response");
  }

  return {
    attachmentID,
    output,
    completedAt: Date.now(),
  };
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
  addRuntime: (conversationID, profileID = "opencode-local") => {
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
            transcript: [
              ...item.transcript,
              createTranscriptItem(
                instance?.status === "error" ? "system" : "assistant",
                instance?.status === "error"
                  ? `Runtime failed: ${instance.lastError}`
                  : "Runtime is running. Local model endpoint is reachable.",
              ),
            ],
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
    const attachment = useRuntimeDockStore
      .getState()
      .attachmentsByConversation[conversationID]?.find(
        (item) => item.id === attachmentID,
      );
    if (!attachment) return;

    const instance = await stopRuntimeBridge(
      attachmentID,
      conversationID,
      attachment.runtimeProfileID,
    );

    set((state) => {
      const nextAttachments = updateAttachment(
        state.attachmentsByConversation,
        conversationID,
        attachmentID,
        (attachment) => ({
          ...attachment,
          status: instance?.status ?? "stopped",
          updatedAt: Date.now(),
          transcript: [
            ...attachment.transcript,
            createTranscriptItem("system", "Runtime stopped."),
          ],
        }),
      );
      return saveAttachments(state, nextAttachments);
    });
  },
  sendPrompt: async (conversationID, attachmentID, prompt) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;

    set((state) => {
      const nextAttachments = updateAttachment(
        state.attachmentsByConversation,
        conversationID,
        attachmentID,
        (attachment) => ({
          ...attachment,
          transcript: [
            ...attachment.transcript,
            createTranscriptItem("user", normalizedPrompt),
          ],
        }),
      );
      return saveAttachments(state, nextAttachments);
    });

    try {
      const result = await sendRuntimePromptBridge(attachmentID, normalizedPrompt);
      set((state) => {
        const nextAttachments = updateAttachment(
          state.attachmentsByConversation,
          conversationID,
          attachmentID,
          (attachment) => ({
            ...attachment,
            updatedAt: Date.now(),
            transcript: [
              ...attachment.transcript,
              createTranscriptItem(
                "assistant",
                result?.output ?? "Runtime returned no output.",
              ),
            ],
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
              createTranscriptItem("system", `Prompt failed: ${message}`),
            ],
          }),
        );
        return saveAttachments(state, nextAttachments);
      });
    }
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
