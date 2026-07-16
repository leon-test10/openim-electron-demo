import { create } from "zustand";

import {
  resolveConversationSession,
  sortAgentSessions,
} from "@/services/agentSessions/sessionModel";
import type {
  AgentHistoryQueryResponse,
  AgentModelOption,
  AgentSession,
  AgentSessionEvent,
  AgentSessionStateSnapshot,
  BotConversationPolicy,
  BotRequest,
  CreateAgentSessionParams,
  SendAgentMessageParams,
  UpdateAgentSessionParams,
} from "@/types/agentSession";

const emptySnapshot: AgentSessionStateSnapshot = {
  sessions: [],
  activeSessionByConversation: {},
  botPolicyByConversation: {},
  botContextLimitByConversation: {},
  botCheckpointByConversation: {},
  botRequests: [],
  agentPanelOpen: true,
  terminalPanelOpen: false,
  initialized: false,
};

interface AgentSessionStore extends AgentSessionStateSnapshot {
  autoApproveBySession: Record<string, boolean>;
  pendingDraftBySession: Record<string, string>;
  navigationTarget?: { conversationID: string; sessionID?: string };
  applySnapshot: (snapshot: AgentSessionStateSnapshot) => void;
  applyEvent: (event: AgentSessionEvent) => void;
  clearNavigationTarget: () => void;
  appendDraft: (sessionID: string, value: string) => void;
  consumeDraft: (sessionID: string) => void;
  initialize: () => Promise<void>;
  createSession: (params: CreateAgentSessionParams) => Promise<string | undefined>;
  updateSession: (params: UpdateAgentSessionParams) => Promise<void>;
  archiveSession: (sessionID: string) => Promise<void>;
  selectSession: (conversationID: string, sessionID?: string) => Promise<void>;
  sendMessage: (params: SendAgentMessageParams) => Promise<void>;
  listModels: (sessionID: string) => Promise<AgentModelOption[]>;
  abort: (sessionID: string) => Promise<void>;
  recover: (sessionID: string) => Promise<void>;
  replyPermission: (
    sessionID: string,
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => Promise<void>;
  replyQuestion: (
    sessionID: string,
    requestID: string,
    answers?: string[][],
    reject?: boolean,
  ) => Promise<void>;
  setAutoApprove: (sessionID: string, enabled: boolean) => Promise<void>;
  markRead: (sessionID: string) => Promise<void>;
  setViewport: (params: {
    conversationID?: string;
    sessionID?: string;
    visible: boolean;
  }) => Promise<void>;
  setPanelState: (params: {
    agentPanelOpen?: boolean;
    terminalPanelOpen?: boolean;
  }) => Promise<void>;
  setBotPolicy: (
    conversationID: string,
    policy: BotConversationPolicy,
    contextLimit?: number,
  ) => Promise<void>;
  setBotCheckpoint: (conversationID: string, clientMsgID?: string) => Promise<void>;
  addBotRequest: (request: BotRequest) => Promise<boolean>;
  ensureBotSession: (conversationID: string) => Promise<AgentSession>;
  ignoreBotRequest: (requestID: string) => Promise<void>;
  runBotRequest: (params: {
    requestID: string;
    prompt: string;
    contextPaths?: string[];
  }) => Promise<void>;
  writeSessionFiles: (
    sessionID: string,
    files: Array<{ relativePath: string; content: string }>,
  ) => Promise<string[]>;
  sendHistoryResponse: (response: AgentHistoryQueryResponse) => Promise<void>;
}

const invoke = async <T>(channel: string, ...args: unknown[]) => {
  if (!window.electronAPI) throw new Error("Agent sessions require the Electron app");
  return window.electronAPI.ipcInvoke<T>(channel, ...args);
};

export const useAgentSessionStore = create<AgentSessionStore>()((set) => ({
  ...emptySnapshot,
  autoApproveBySession: {},
  pendingDraftBySession: {},
  applySnapshot: (snapshot) => set(snapshot),
  applyEvent: (event) => {
    if (event.type === "snapshot") {
      set(event.snapshot);
      return;
    }
    if (event.type === "navigate") {
      set({
        navigationTarget: {
          conversationID: event.conversationID,
          sessionID: event.sessionID,
        },
      });
    }
  },
  clearNavigationTarget: () => set({ navigationTarget: undefined }),
  appendDraft: (sessionID, value) =>
    set((state) => ({
      pendingDraftBySession: {
        ...state.pendingDraftBySession,
        [sessionID]: `${state.pendingDraftBySession[sessionID] ?? ""}${value}`,
      },
    })),
  consumeDraft: (sessionID) =>
    set((state) => ({
      pendingDraftBySession: {
        ...state.pendingDraftBySession,
        [sessionID]: "",
      },
    })),
  initialize: async () => {
    if (!window.electronAPI) {
      set({ initialized: true });
      return;
    }
    const snapshot = await invoke<AgentSessionStateSnapshot>("agent-session:list");
    set(snapshot);
  },
  createSession: async (params) => {
    const session = await invoke<{ id: string }>("agent-session:create", params);
    return session?.id;
  },
  updateSession: async (params) => {
    await invoke("agent-session:update", params);
  },
  archiveSession: async (sessionID) => {
    await invoke("agent-session:archive", sessionID);
  },
  selectSession: async (conversationID, sessionID) => {
    await invoke("agent-session:select", { conversationID, sessionID });
  },
  sendMessage: async (params) => {
    await invoke("agent-session:send", params);
  },
  listModels: async (sessionID) => {
    return invoke<AgentModelOption[]>("agent-session:listModels", sessionID);
  },
  abort: async (sessionID) => {
    await invoke("agent-session:abort", sessionID);
  },
  recover: async (sessionID) => {
    await invoke("agent-session:recover", sessionID);
  },
  replyPermission: async (sessionID, requestID, reply) => {
    await invoke("agent-session:replyPermission", { sessionID, requestID, reply });
  },
  replyQuestion: async (sessionID, requestID, answers, reject) => {
    await invoke("agent-session:replyQuestion", {
      sessionID,
      requestID,
      answers,
      reject,
    });
  },
  setAutoApprove: async (sessionID, enabled) => {
    await invoke("agent-session:setAutoApprove", { sessionID, enabled });
    set((state) => ({
      autoApproveBySession: {
        ...state.autoApproveBySession,
        [sessionID]: enabled,
      },
    }));
  },
  markRead: async (sessionID) => {
    await invoke("agent-session:markRead", sessionID);
  },
  setViewport: async (params) => {
    if (!window.electronAPI) return;
    await invoke("agent-session:setViewport", params);
  },
  setPanelState: async (params) => {
    await invoke("agent-session:setPanelState", params);
  },
  setBotPolicy: async (conversationID, policy, contextLimit) => {
    await invoke("agent-session:setBotPolicy", {
      conversationID,
      policy,
      contextLimit,
    });
  },
  setBotCheckpoint: async (conversationID, clientMsgID) => {
    await invoke("agent-session:setBotCheckpoint", { conversationID, clientMsgID });
    set((state) => ({
      botCheckpointByConversation: {
        ...state.botCheckpointByConversation,
        [conversationID]: clientMsgID,
      },
    }));
  },
  addBotRequest: async (request) => {
    const result = await invoke<{ added: boolean }>(
      "agent-session:addBotRequest",
      request,
    );
    return result.added;
  },
  ensureBotSession: async (conversationID) => {
    return invoke<AgentSession>("agent-session:ensureBotSession", conversationID);
  },
  ignoreBotRequest: async (requestID) => {
    await invoke("agent-session:ignoreBotRequest", requestID);
  },
  runBotRequest: async (params) => {
    await invoke("agent-session:runBotRequest", params);
  },
  writeSessionFiles: async (sessionID, files) => {
    return invoke<string[]>("agent-session:writeFiles", { sessionID, files });
  },
  sendHistoryResponse: async (response) => {
    await invoke("agent-session:historyResponse", response);
  },
}));

export const getAgentSessionsForConversation = (conversationID?: string) => {
  if (!conversationID) return [];
  return sortAgentSessions(
    useAgentSessionStore
      .getState()
      .sessions.filter(
        (session) => session.conversationID === conversationID && !session.archived,
      ),
  );
};

export const getActiveAgentSession = (conversationID?: string) => {
  if (!conversationID) return undefined;
  const state = useAgentSessionStore.getState();
  const activeID = state.activeSessionByConversation[conversationID];
  return resolveConversationSession(state.sessions, conversationID, activeID);
};
