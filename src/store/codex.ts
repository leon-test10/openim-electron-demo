import { create } from "zustand";

import {
  CodexConversationStatus,
  CodexRuntimeEvent,
  CodexSessionRecord,
} from "@/types/codex";

interface CodexStateEntry {
  status: CodexConversationStatus | null;
  sessions: CodexSessionRecord[];
  eventsByJobId: Record<string, CodexRuntimeEvent[]>;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

interface CodexStore {
  conversations: Record<string, CodexStateEntry>;
  setLoading: (conversationID: string, loading: boolean) => void;
  setStatus: (conversationID: string, status: CodexConversationStatus) => void;
  setSessions: (conversationID: string, sessions: CodexSessionRecord[]) => void;
  setJobEvents: (
    conversationID: string,
    jobID: string,
    events: CodexRuntimeEvent[],
  ) => void;
  appendJobEvents: (
    conversationID: string,
    jobID: string,
    events: CodexRuntimeEvent[],
  ) => void;
  setError: (conversationID: string, error: string | null) => void;
}

const emptyEntry: CodexStateEntry = {
  status: null,
  sessions: [],
  eventsByJobId: {},
  loading: false,
  error: null,
  updatedAt: null,
};

export const useCodexStore = create<CodexStore>()((set) => ({
  conversations: {},
  setLoading: (conversationID, loading) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          loading,
        },
      },
    })),
  setStatus: (conversationID, status) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          status,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        },
      },
    })),
  setSessions: (conversationID, sessions) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          sessions,
          updatedAt: Date.now(),
        },
      },
    })),
  setJobEvents: (conversationID, jobID, events) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            eventsByJobId: {
              ...entry.eventsByJobId,
              [jobID]: events,
            },
            updatedAt: Date.now(),
          },
        },
      };
    }),
  appendJobEvents: (conversationID, jobID, events) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      const existing = entry.eventsByJobId[jobID] ?? [];
      const bySequence = new Map(
        [...existing, ...events].map((event) => [event.sequence, event]),
      );
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            eventsByJobId: {
              ...entry.eventsByJobId,
              [jobID]: Array.from(bySequence.values()).sort(
                (left, right) => left.sequence - right.sequence,
              ),
            },
            updatedAt: Date.now(),
          },
        },
      };
    }),
  setError: (conversationID, error) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          loading: false,
          error,
          updatedAt: Date.now(),
        },
      },
    })),
}));
