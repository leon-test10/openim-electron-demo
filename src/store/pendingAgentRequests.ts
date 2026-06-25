import { create } from "zustand";

import { PendingAgentRequest } from "@/services/botTrigger";

export interface PendingAgentRequestStore {
  botDetectionEnabled: boolean;
  requestsByConversation: Record<string, PendingAgentRequest[]>;
  setBotDetectionEnabled: (enabled: boolean) => void;
  addRequest: (request: PendingAgentRequest) => void;
  markSent: (conversationID: string, requestID: string) => void;
  markIgnored: (conversationID: string, requestID: string) => void;
  dismissRequest: (conversationID: string, requestID: string) => void;
  promoteToAutoInject: (conversationID: string) => void;
  clearConversationRequests: (conversationID: string) => void;
}

const updateRequestStatus = (
  requests: PendingAgentRequest[],
  requestID: string,
  status: PendingAgentRequest["status"],
) =>
  requests.map((request) =>
    request.id === requestID
      ? {
          ...request,
          status,
        }
      : request,
  );

export const usePendingAgentRequestStore = create<PendingAgentRequestStore>()(
  (set) => ({
    botDetectionEnabled: false,
    requestsByConversation: {},
    setBotDetectionEnabled: (botDetectionEnabled) => {
      set({ botDetectionEnabled });
    },
    addRequest: (request) => {
      set((state) => {
        const current = state.requestsByConversation[request.conversationID] ?? [];
        const duplicated = current.some(
          (item) => item.triggerMessageID === request.triggerMessageID,
        );
        if (duplicated) return state;

        return {
          requestsByConversation: {
            ...state.requestsByConversation,
            [request.conversationID]: [request, ...current].slice(0, 20),
          },
        };
      });
    },
    markSent: (conversationID, requestID) => {
      set((state) => ({
        requestsByConversation: {
          ...state.requestsByConversation,
          [conversationID]: updateRequestStatus(
            state.requestsByConversation[conversationID] ?? [],
            requestID,
            "sent",
          ),
        },
      }));
    },
    markIgnored: (conversationID, requestID) => {
      set((state) => ({
        requestsByConversation: {
          ...state.requestsByConversation,
          [conversationID]: updateRequestStatus(
            state.requestsByConversation[conversationID] ?? [],
            requestID,
            "ignored",
          ),
        },
      }));
    },
    dismissRequest: (conversationID, requestID) => {
      set((state) => ({
        requestsByConversation: {
          ...state.requestsByConversation,
          [conversationID]: updateRequestStatus(
            state.requestsByConversation[conversationID] ?? [],
            requestID,
            "dismissed",
          ),
        },
      }));
    },
    promoteToAutoInject: (conversationID) => {
      set((state) => {
        const current = state.requestsByConversation[conversationID];
        if (!current || current.length === 0) return state;

        return {
          requestsByConversation: {
            ...state.requestsByConversation,
            [conversationID]: current.map((request) =>
              request.status === "pending"
                ? { ...request, status: "sent" as const }
                : request,
            ),
          },
        };
      });
    },
    clearConversationRequests: (conversationID) => {
      set((state) => {
        const requestsByConversation = {
          ...state.requestsByConversation,
        };
        delete requestsByConversation[conversationID];
        return { requestsByConversation };
      });
    },
  }),
);
