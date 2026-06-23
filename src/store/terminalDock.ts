import { create } from "zustand";

import {
  TerminalCaptureSource,
  TerminalCommandTemplate,
  TerminalDockStore,
  TerminalEvent,
  TerminalInstance,
  TerminalOutputChunk,
  TerminalTab,
  TerminalWorkspace,
} from "./type";

export type { TerminalTab, TerminalWorkspace } from "./type";

const STORAGE_KEY = "openim_terminal_dock_state";
const LEGACY_RUNTIME_KEY = "openim_runtime_dock_state";

const DEFAULT_COMMAND_TEMPLATES: TerminalCommandTemplate[] = [
  {
    id: "opencode",
    title: "Run opencode",
    command: "npx.cmd -y opencode-ai@1.17.9",
    description: "Start opencode TUI in this workspace via pinned npx command",
    enabled: true,
  },
];

type StoredTerminalDockState = Pick<
  TerminalDockStore,
  | "panelOpen"
  | "workspaces"
  | "activeWorkspaceID"
  | "tabsByWorkspace"
  | "activeTabByWorkspace"
  | "lastContextPromptByWorkspace"
  | "commandTemplates"
  | "autoReceiveEnabled"
  | "autoSendEnabled"
  | "captureSource"
>;

const defaultState: StoredTerminalDockState = {
  panelOpen: false,
  workspaces: [],
  activeWorkspaceID: undefined,
  tabsByWorkspace: {},
  activeTabByWorkspace: {},
  lastContextPromptByWorkspace: {},
  commandTemplates: DEFAULT_COMMAND_TEMPLATES,
  autoReceiveEnabled: false,
  autoSendEnabled: false,
  captureSource: "auto",
};

const canUseLocalStorage = () => typeof window !== "undefined" && window.localStorage;

const createID = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeTab = (tab: TerminalTab): TerminalTab => ({
  ...tab,
  status:
    tab.status === "running" || tab.status === "starting" ? "stopped" : tab.status,
  lastError: undefined,
  updatedAt: Date.now(),
});

const normalizeCommandTemplates = (templates: unknown): TerminalCommandTemplate[] => {
  const parsedTemplates = Array.isArray(templates) ? templates : [];
  const byID = new Map(DEFAULT_COMMAND_TEMPLATES.map((item) => [item.id, item]));

  parsedTemplates.forEach((template) => {
    if (!template || typeof template !== "object") return;
    const item = template as Partial<TerminalCommandTemplate>;
    if (typeof item.id !== "string" || !item.id) return;
    const defaultTemplate = DEFAULT_COMMAND_TEMPLATES.find(
      (candidate) => candidate.id === item.id,
    );
    const command =
      item.id === "opencode" && (!item.command || item.command === "opencode")
        ? DEFAULT_COMMAND_TEMPLATES[0].command
        : typeof item.command === "string"
        ? item.command
        : defaultTemplate?.command ?? "";

    byID.set(item.id, {
      id: item.id,
      title:
        typeof item.title === "string" ? item.title : defaultTemplate?.title ?? item.id,
      command,
      description:
        typeof item.description === "string"
          ? item.description
          : defaultTemplate?.description ?? "",
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
    });
  });

  return Array.from(byID.values());
};

const readLegacyPanelOpen = () => {
  if (!canUseLocalStorage()) return false;

  try {
    const raw = window.localStorage.getItem(LEGACY_RUNTIME_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { panelOpen?: unknown };
    return typeof parsed.panelOpen === "boolean" ? parsed.panelOpen : false;
  } catch {
    return false;
  }
};

const readStoredState = (): StoredTerminalDockState => {
  if (!canUseLocalStorage()) return defaultState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        ...defaultState,
        panelOpen: readLegacyPanelOpen(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredTerminalDockState>;

    return {
      panelOpen:
        typeof parsed.panelOpen === "boolean"
          ? parsed.panelOpen
          : defaultState.panelOpen,
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      activeWorkspaceID:
        typeof parsed.activeWorkspaceID === "string"
          ? parsed.activeWorkspaceID
          : undefined,
      tabsByWorkspace:
        parsed.tabsByWorkspace && typeof parsed.tabsByWorkspace === "object"
          ? Object.fromEntries(
              Object.entries(parsed.tabsByWorkspace).map(([workspaceID, tabs]) => [
                workspaceID,
                Array.isArray(tabs) ? tabs.map(normalizeTab) : [],
              ]),
            )
          : {},
      activeTabByWorkspace:
        parsed.activeTabByWorkspace && typeof parsed.activeTabByWorkspace === "object"
          ? parsed.activeTabByWorkspace
          : {},
      lastContextPromptByWorkspace:
        parsed.lastContextPromptByWorkspace &&
        typeof parsed.lastContextPromptByWorkspace === "object"
          ? parsed.lastContextPromptByWorkspace
          : {},
      commandTemplates: normalizeCommandTemplates(parsed.commandTemplates),
      autoReceiveEnabled:
        typeof parsed.autoReceiveEnabled === "boolean"
          ? parsed.autoReceiveEnabled
          : false,
      autoSendEnabled:
        typeof parsed.autoSendEnabled === "boolean" ? parsed.autoSendEnabled : false,
      captureSource:
        parsed.captureSource === "screen" ||
        parsed.captureSource === "raw" ||
        parsed.captureSource === "auto"
          ? parsed.captureSource
          : "auto",
    };
  } catch {
    return defaultState;
  }
};

const persistState = (state: StoredTerminalDockState) => {
  if (!canUseLocalStorage()) return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const toStoredState = (state: TerminalDockStore): StoredTerminalDockState => ({
  panelOpen: state.panelOpen,
  workspaces: state.workspaces,
  activeWorkspaceID: state.activeWorkspaceID,
  tabsByWorkspace: state.tabsByWorkspace,
  activeTabByWorkspace: state.activeTabByWorkspace,
  lastContextPromptByWorkspace: state.lastContextPromptByWorkspace,
  commandTemplates: state.commandTemplates,
  autoReceiveEnabled: state.autoReceiveEnabled,
  autoSendEnabled: state.autoSendEnabled,
  captureSource: state.captureSource,
});

const save = (state: TerminalDockStore, patch: Partial<TerminalDockStore>) => {
  persistState(toStoredState({ ...state, ...patch } as TerminalDockStore));
  return patch;
};

const createOutputChunk = (tabID: string, content: string): TerminalOutputChunk => ({
  id: createID("term_out"),
  tabID,
  content,
  createdAt: Date.now(),
});

const findWorkspace = (state: TerminalDockStore, workspaceID: string) =>
  state.workspaces.find((workspace) => workspace.id === workspaceID);

const findTab = (state: TerminalDockStore, tabID: string) => {
  for (const tabs of Object.values(state.tabsByWorkspace)) {
    const tab = tabs.find((item) => item.id === tabID);
    if (tab) return tab;
  }
  return undefined;
};

const updateTabByID = (
  tabsByWorkspace: Record<string, TerminalTab[]>,
  tabID: string,
  updater: (tab: TerminalTab) => TerminalTab,
) =>
  Object.fromEntries(
    Object.entries(tabsByWorkspace).map(([workspaceID, tabs]) => [
      workspaceID,
      tabs.map((tab) => (tab.id === tabID ? updater(tab) : tab)),
    ]),
  );

const ensureElectron = () => {
  if (!window.electronAPI) {
    throw new Error("Terminal is available only in the Electron client.");
  }
  return window.electronAPI;
};

const getWorkspaceDir = async (workspaceID: string) =>
  ensureElectron().ipcInvoke<string>("terminal:getWorkspaceDir", workspaceID);

const startBridge = async (tab: TerminalTab) =>
  ensureElectron().ipcInvoke<TerminalInstance>("terminal:start", {
    tabID: tab.id,
    workspaceID: tab.workspaceID,
    cwd: tab.cwd,
  });

const stopBridge = async (tabID: string) =>
  ensureElectron().ipcInvoke<TerminalInstance | undefined>("terminal:stop", tabID);

export const useTerminalDockStore = create<TerminalDockStore>()((set, get) => ({
  ...readStoredState(),
  outputByTab: {},
  lastCapturedTextByTab: {},
  togglePanel: () => {
    set((state) => {
      const panelOpen = !state.panelOpen;
      return save(state, { panelOpen });
    });
  },
  setPanelOpen: (panelOpen) => {
    set((state) => save(state, { panelOpen }));
  },
  createWorkspace: async (title) => {
    try {
      const id = createID("workspace");
      const rootPath = await getWorkspaceDir(id);
      const now = Date.now();
      const workspace: TerminalWorkspace = {
        id,
        title: title?.trim() || `Workspace ${get().workspaces.length + 1}`,
        rootPath,
        linkedConversationIDs: [],
        createdAt: now,
        updatedAt: now,
      };

      set((state) =>
        save(state, {
          workspaces: [...state.workspaces, workspace],
          activeWorkspaceID: id,
          tabsByWorkspace: {
            ...state.tabsByWorkspace,
            [id]: [],
          },
          activeTabByWorkspace: {
            ...state.activeTabByWorkspace,
            [id]: undefined,
          },
        }),
      );
      return id;
    } catch (error) {
      console.error("[terminalDock] create workspace failed", error);
      return undefined;
    }
  },
  setActiveWorkspace: (workspaceID) => {
    set((state) => save(state, { activeWorkspaceID: workspaceID }));
  },
  linkConversationToWorkspace: (workspaceID, conversationID) => {
    if (!conversationID) return;

    set((state) => {
      const workspaces = state.workspaces.map((workspace) => {
        if (workspace.id !== workspaceID) return workspace;
        if (workspace.linkedConversationIDs.includes(conversationID)) {
          return workspace;
        }

        return {
          ...workspace,
          linkedConversationIDs: [...workspace.linkedConversationIDs, conversationID],
          updatedAt: Date.now(),
        };
      });
      return save(state, { workspaces });
    });
  },
  createTab: (workspaceID, options) => {
    const workspace = findWorkspace(get(), workspaceID);
    if (!workspace) return Promise.resolve(undefined);

    const now = Date.now();
    const id = createID("terminal");
    const tab: TerminalTab = {
      id,
      workspaceID,
      title:
        options?.title?.trim() ||
        `Terminal ${(get().tabsByWorkspace[workspaceID] ?? []).length + 1}`,
      shell: "powershell.exe",
      cwd: workspace.rootPath,
      status: "detached",
      createdAt: now,
      updatedAt: now,
    };

    set((state) =>
      save(state, {
        tabsByWorkspace: {
          ...state.tabsByWorkspace,
          [workspaceID]: [...(state.tabsByWorkspace[workspaceID] ?? []), tab],
        },
        activeTabByWorkspace: {
          ...state.activeTabByWorkspace,
          [workspaceID]: id,
        },
      }),
    );
    return Promise.resolve(id);
  },
  setActiveTab: (workspaceID, tabID) => {
    set((state) =>
      save(state, {
        activeTabByWorkspace: {
          ...state.activeTabByWorkspace,
          [workspaceID]: tabID,
        },
      }),
    );
  },
  startTab: async (tabID) => {
    const tab = findTab(get(), tabID);
    if (!tab) return;

    set((state) =>
      save(state, {
        tabsByWorkspace: updateTabByID(state.tabsByWorkspace, tabID, (item) => ({
          ...item,
          status: "starting",
          lastError: undefined,
          updatedAt: Date.now(),
        })),
      }),
    );

    try {
      const instance = await startBridge(tab);
      set((state) =>
        save(state, {
          tabsByWorkspace: updateTabByID(state.tabsByWorkspace, tabID, (item) => ({
            ...item,
            shell: instance.shell,
            cwd: instance.cwd,
            status: instance.status,
            lastError: instance.lastError,
            updatedAt: instance.updatedAt,
          })),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) =>
        save(state, {
          tabsByWorkspace: updateTabByID(state.tabsByWorkspace, tabID, (item) => ({
            ...item,
            status: "error",
            lastError: message,
            updatedAt: Date.now(),
          })),
          outputByTab: {
            ...state.outputByTab,
            [tabID]: [
              ...(state.outputByTab[tabID] ?? []),
              createOutputChunk(tabID, `\r\n[start failed] ${message}\r\n`),
            ],
          },
        }),
      );
    }
  },
  restartTab: async (tabID) => {
    await get().stopTab(tabID);
    get().clearTabOutput(tabID);
    await get().startTab(tabID);
  },
  interruptTab: async (tabID) => {
    try {
      await ensureElectron().ipcInvoke("terminal:interrupt", tabID);
    } catch (error) {
      console.error("[terminalDock] interrupt failed", error);
    }
  },
  stopTab: async (tabID) => {
    try {
      const instance = await stopBridge(tabID);
      set((state) =>
        save(state, {
          tabsByWorkspace: updateTabByID(state.tabsByWorkspace, tabID, (item) => ({
            ...item,
            status: instance?.status ?? "stopped",
            updatedAt: Date.now(),
          })),
        }),
      );
    } catch (error) {
      console.error("[terminalDock] stop failed", error);
    }
  },
  writeToTab: async (tabID, data) => {
    if (!data) return;
    await ensureElectron().ipcInvoke("terminal:write", { tabID, data });
  },
  clearTabOutput: (tabID) => {
    set((state) => ({
      outputByTab: {
        ...state.outputByTab,
        [tabID]: [],
      },
    }));
  },
  removeTab: async (workspaceID, tabID) => {
    await get().stopTab(tabID);
    set((state) =>
      save(state, {
        tabsByWorkspace: {
          ...state.tabsByWorkspace,
          [workspaceID]: (state.tabsByWorkspace[workspaceID] ?? []).filter(
            (tab) => tab.id !== tabID,
          ),
        },
        activeTabByWorkspace: {
          ...state.activeTabByWorkspace,
          [workspaceID]:
            state.activeTabByWorkspace[workspaceID] === tabID
              ? undefined
              : state.activeTabByWorkspace[workspaceID],
        },
      }),
    );
  },
  handleTerminalEvent: (event: TerminalEvent) => {
    set((state) =>
      save(state, {
        tabsByWorkspace: updateTabByID(state.tabsByWorkspace, event.tabID, (tab) => ({
          ...tab,
          status:
            event.type === "started"
              ? "running"
              : event.type === "exit" || event.type === "stopped"
              ? "stopped"
              : event.type === "error"
              ? "error"
              : tab.status,
          lastError: event.type === "error" ? event.data : tab.lastError,
          updatedAt: event.timestamp,
        })),
        outputByTab: event.data
          ? {
              ...state.outputByTab,
              [event.tabID]: [
                ...(state.outputByTab[event.tabID] ?? []),
                createOutputChunk(event.tabID, event.data),
              ],
            }
          : state.outputByTab,
      }),
    );
  },
  setLastContextPrompt: (workspaceID, prompt) => {
    set((state) =>
      save(state, {
        lastContextPromptByWorkspace: {
          ...state.lastContextPromptByWorkspace,
          [workspaceID]: prompt,
        },
      }),
    );
  },
  updateCommandTemplate: (templateID, patch) => {
    set((state) =>
      save(state, {
        commandTemplates: state.commandTemplates.map((template) =>
          template.id === templateID
            ? {
                ...template,
                ...patch,
                title: patch.title ?? template.title,
                command: patch.command ?? template.command,
                description: patch.description ?? template.description,
              }
            : template,
        ),
      }),
    );
  },
  addCommandTemplate: () => {
    const id = createID("command");
    set((state) =>
      save(state, {
        commandTemplates: [
          ...state.commandTemplates,
          {
            id,
            title: "Run command",
            command: "",
            description: "Custom terminal command",
            enabled: true,
          },
        ],
      }),
    );
  },
  removeCommandTemplate: (templateID) => {
    if (templateID === "opencode") return;
    set((state) =>
      save(state, {
        commandTemplates: state.commandTemplates.filter(
          (template) => template.id !== templateID,
        ),
      }),
    );
  },
  resetCommandTemplates: () => {
    set((state) =>
      save(state, {
        commandTemplates: DEFAULT_COMMAND_TEMPLATES,
      }),
    );
  },
  setAutoReceiveEnabled: (autoReceiveEnabled) => {
    set((state) => save(state, { autoReceiveEnabled }));
  },
  setAutoSendEnabled: (autoSendEnabled) => {
    set((state) => save(state, { autoSendEnabled }));
  },
  setCaptureSource: (captureSource: TerminalCaptureSource) => {
    set((state) => save(state, { captureSource }));
  },
  setLastCapturedText: (tabID, text) => {
    set((state) => ({
      lastCapturedTextByTab: {
        ...state.lastCapturedTextByTab,
        [tabID]: text,
      },
    }));
  },
}));

export const getActiveTerminalWorkspace = () => {
  const state = useTerminalDockStore.getState();
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceID);
};
