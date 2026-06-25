import { Platform, SessionType } from "@openim/wasm-client-sdk";
import { useEffect, useMemo, useState } from "react";

import TerminalDock from "@/components/TerminalDock";
import {
  createPendingAgentRequest,
  detectBotTrigger,
  extractTextMessageContent,
  isAgentGeneratedMessage,
} from "@/services/botTrigger";
import {
  useConversationStore,
  useMessageSelectionStore,
  usePendingAgentRequestStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import {
  e2eConversation,
  e2eConversationID,
  e2eGroupConversation,
  e2eGroupMessages,
  e2eMessages,
} from "@/utils/e2eMockData";
import emitter, { PendingChatAttachmentParams } from "@/utils/events";

import ChatHeader from "../chat/queryChat/ChatHeader";
import MessageHistoryDrawer from "../chat/queryChat/MessageHistoryDrawer";
import MessageItem from "../chat/queryChat/MessageItem";
import MessageSelectionBoundary from "../chat/queryChat/MessageSelectionBoundary";
import MessageSelectionToolbar from "../chat/queryChat/MessageSelectionToolbar";
import PendingAgentRequests from "../chat/queryChat/PendingAgentRequests";

const installE2EElectronMock = () => {
  if (typeof window === "undefined" || window.electronAPI) return;

  const subscribers = new Map<string, Set<(...args: unknown[]) => void>>();
  const watchedAgentWorkspaces = new Set<string>();
  const workspaceRoot = "C:\\OpenIM-E2E\\workspaces";
  const e2eWindow = window as unknown as {
    __e2eTerminalWrites?: string[];
    __e2eWorkspaceWrites?: Array<{
      relativePath?: string;
      content?: string;
    }>;
    __e2eAttachmentExportCalls?: Array<{
      channel: string;
      relativePath?: string;
    }>;
    __e2eSentMessages?: Array<{
      fileName?: string;
      filePath?: string;
      contentType?: number;
    }>;
    __e2eEmitTerminalOutput?: (text: string) => void;
    __e2eStructuredEvents?: Array<{
      workspaceID: string;
      event: Record<string, unknown>;
      timestamp: number;
    }>;
    __e2eEmitStructuredEvent?: (
      workspaceID: string,
      event: Record<string, unknown>,
    ) => void;
    __e2eGetActiveWorkspaceID?: () => string | undefined;
    __e2eLinkActiveConversationToWorkspace?: () => void;
  };
  e2eWindow.__e2eTerminalWrites = [];
  e2eWindow.__e2eWorkspaceWrites = [];
  e2eWindow.__e2eAttachmentExportCalls = [];
  e2eWindow.__e2eSentMessages = [];
  e2eWindow.__e2eStructuredEvents = [];
  e2eWindow.__e2eEmitTerminalOutput = (text: string) => {
    const state = useTerminalDockStore.getState();
    const workspaceID = state.activeWorkspaceID;
    const tabID = workspaceID
      ? state.activeTabByWorkspace[workspaceID] ??
        state.tabsByWorkspace[workspaceID]?.[0]?.id
      : undefined;
    if (!tabID) return;

    state.handleTerminalEvent({
      tabID,
      type: "stdout",
      data: text,
      timestamp: Date.now(),
    });
  };
  e2eWindow.__e2eGetActiveWorkspaceID = () =>
    useTerminalDockStore.getState().activeWorkspaceID;
  e2eWindow.__e2eLinkActiveConversationToWorkspace = () => {
    const state = useTerminalDockStore.getState();
    if (state.activeWorkspaceID) {
      state.linkConversationToWorkspace(state.activeWorkspaceID, e2eConversationID);
    }
  };

  const createMockFile = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).filter(Boolean).pop() ?? "mock-file.txt";
    const lowerName = fileName.toLowerCase();
    const type = lowerName.endsWith(".png")
      ? "image/png"
      : lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
      ? "image/jpeg"
      : lowerName.endsWith(".gif")
      ? "image/gif"
      : lowerName.endsWith(".webp")
      ? "image/webp"
      : lowerName.endsWith(".md")
      ? "text/markdown"
      : lowerName.endsWith(".json")
      ? "application/json"
      : lowerName.endsWith(".txt")
      ? "text/plain"
      : "application/octet-stream";
    return new File([`e2e fixture for ${fileName}`], fileName, { type });
  };

  const emitToSubscribers = (channel: string, ...args: unknown[]) => {
    const callbacks = subscribers.get(channel);
    callbacks?.forEach((callback) => callback(...args));
  };

  const emitStructuredEvent = (workspaceID: string, event: Record<string, unknown>) => {
    const payload = { workspaceID, event, timestamp: Date.now() };
    e2eWindow.__e2eStructuredEvents?.push(payload);
    emitToSubscribers("agent:structuredOutput", payload);
    useTerminalDockStore
      .getState()
      .addStructuredEvent(
        workspaceID,
        event as unknown as import("@/services/agentOutput").AgentOutputEvent,
      );
  };

  e2eWindow.__e2eEmitStructuredEvent = emitStructuredEvent;

  const emitTerminalEvent = (
    event: Parameters<
      ReturnType<typeof useTerminalDockStore.getState>["handleTerminalEvent"]
    >[0],
  ) => {
    emitToSubscribers("terminal:event", event);
    useTerminalDockStore.getState().handleTerminalEvent(event);
  };

  window.electronAPI = {
    getDataPath: () => "C:\\OpenIM-E2E",
    getVersion: () => "e2e",
    getPlatform: () => Platform.Windows,
    getSystemVersion: () => "e2e",
    subscribe: (channel: string, callback: (...args: unknown[]) => void) => {
      const callbacks = subscribers.get(channel) ?? new Set();
      callbacks.add(callback);
      subscribers.set(channel, callbacks);
      return () => {
        callbacks.delete(callback);
      };
    },
    subscribeOnce: (channel: string, callback: (...args: unknown[]) => void) => {
      const unsubscribe = window.electronAPI?.subscribe(
        channel,
        (...args: unknown[]) => {
          unsubscribe?.();
          callback(...args);
        },
      );
    },
    unsubscribeAll: (channel: string) => {
      subscribers.delete(channel);
    },
    ipcInvoke: <T,>(channel: string, ...args: unknown[]): Promise<T> => {
      let result: unknown;

      if (channel === "terminal:getWorkspaceDir") {
        result = `${workspaceRoot}\\${args[0]}`;
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:start") {
        const params = args[0] as {
          tabID: string;
          workspaceID: string;
          cwd: string;
        };
        result = {
          id: params.tabID,
          workspaceID: params.workspaceID,
          cwd: params.cwd,
          shell: "powershell.exe",
          status: "running",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        window.setTimeout(() => {
          emitTerminalEvent({
            tabID: params.tabID,
            type: "started",
            timestamp: Date.now(),
          });
          emitTerminalEvent({
            tabID: params.tabID,
            type: "stdout",
            data: "Windows PowerShell\nPS C:\\OpenIM-E2E\\workspaces> Write-Host READY\nREADY\n",
            timestamp: Date.now(),
          });
        }, 0);
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:write") {
        const params = args[0] as { data?: string };
        e2eWindow.__e2eTerminalWrites?.push(params.data ?? "");
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "workspace:writeWorkspaceFile") {
        const params = args[0] as {
          workspaceID?: string;
          relativePath?: string;
          content?: string;
        };
        e2eWindow.__e2eWorkspaceWrites?.push(params);
        if (
          params.workspaceID &&
          params.relativePath === ".agent/events.ndjson" &&
          watchedAgentWorkspaces.has(params.workspaceID)
        ) {
          window.setTimeout(() => {
            params.content?.split("\n").forEach((line) => {
              const trimmed = line.trim();
              if (!trimmed) return;
              try {
                const parsed = JSON.parse(trimmed) as unknown;
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  emitStructuredEvent(
                    params.workspaceID!,
                    parsed as Record<string, unknown>,
                  );
                }
              } catch {
                // Ignore malformed E2E NDJSON lines.
              }
            });
          }, 0);
        }
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:resize" || channel === "terminal:interrupt") {
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "workspace:copyWorkspaceFile") {
        const params = args[0] as { relativePath: string };
        e2eWindow.__e2eAttachmentExportCalls?.push({
          channel,
          relativePath: params.relativePath,
        });
        result = {
          ok: true,
          path: `${workspaceRoot}\\mock\\${params.relativePath.replaceAll("/", "\\")}`,
          size: 1024,
          sha256: "e2e-image-sha256",
        };
        return Promise.resolve(result as T);
      }

      if (channel === "workspace:downloadWorkspaceFile") {
        const params = args[0] as { url: string; relativePath: string };
        e2eWindow.__e2eAttachmentExportCalls?.push({
          channel,
          relativePath: params.relativePath,
        });
        if (params.url.includes("fail-download")) {
          return Promise.reject(new Error("E2E attachment download failed"));
        }
        result = {
          ok: true,
          path: `${workspaceRoot}\\mock\\${params.relativePath.replaceAll("/", "\\")}`,
          size: 2048,
          sha256: "e2e-download-sha256",
        };
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:stop") {
        const tabID = args[0] as string;
        window.setTimeout(() => {
          emitTerminalEvent({
            tabID,
            type: "stopped",
            timestamp: Date.now(),
          });
        }, 0);
        return Promise.resolve(undefined as T);
      }

      if (channel === "agent:startWatch") {
        watchedAgentWorkspaces.add(args[0] as string);
        result = {
          ok: true,
          workspaceID: args[0],
          filePath: `${workspaceRoot}\\${args[0]}\\.agent\\events.ndjson`,
        };
        return Promise.resolve(result as T);
      }

      if (channel === "agent:stopWatch") {
        watchedAgentWorkspaces.delete(args[0] as string);
        result = { ok: true, workspaceID: args[0] };
        return Promise.resolve(result as T);
      }

      if (channel === "opencode:probeServer") {
        const params = args[0] as { workspaceID: string; mockMode?: string };
        const state = useTerminalDockStore.getState();
        const workspace = state.workspaces.find(
          (item) => item.id === params.workspaceID,
        );
        const rootPath = workspace?.rootPath ?? `${workspaceRoot}\\mock`;
        if (params.mockMode === "bound") {
          result = {
            runtime: "opencode",
            serveCommandAvailable: true,
            configuredServerReachable: true,
            tuiAttachSupported: true,
            sessionListAvailable: true,
            sessionExportAvailable: true,
            sameSessionEvidence:
              "Server session messages include an assistant message.",
            binding: {
              runtime: "opencode",
              workspaceRoot: rootPath,
              serverBaseUrl: "http://127.0.0.1:4096",
              sessionID: "e2e-session",
              mode: "shared-server-session",
              status: "bound",
              reason: "OpenCode server/session messages are readable.",
              lastCheckedAt: Date.now(),
            },
            lastAssistantMessage: "OpenCode shared-session reply from mock.",
          };
        } else {
          result = {
            runtime: "opencode",
            serveCommandAvailable: false,
            configuredServerReachable: false,
            tuiAttachSupported: false,
            sessionListAvailable: false,
            sessionExportAvailable: false,
            sameSessionEvidence: "OpenCode server unavailable.",
            binding: {
              runtime: "opencode",
              workspaceRoot: rootPath,
              serverBaseUrl: "http://127.0.0.1:4096",
              mode: "tui-only",
              status: "failed",
              reason: "OpenCode server unavailable.",
              lastCheckedAt: Date.now(),
            },
          };
        }
        return Promise.resolve(result as T);
      }

      if (channel === "opencode:startServer" || channel === "opencode:stopServer") {
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:openWorkspace") {
        result = "";
        return Promise.resolve(result as T);
      }

      return Promise.resolve(undefined as T);
    },
    ipcSendSync: <T,>() => undefined as T,
    saveFileToDisk: () => Promise.resolve(""),
    getFileByPath: (filePath: string) => Promise.resolve(createMockFile(filePath)),
  };
};

// Install E2E introspection helper before component mounts (works in both
// browser-mock and real-Electron modes).
if (typeof window !== "undefined") {
  const e2eGlobal = window as unknown as {
    __e2eGetActiveWorkspaceID?: () => string | undefined;
  };
  e2eGlobal.__e2eGetActiveWorkspaceID = () =>
    useTerminalDockStore.getState().activeWorkspaceID;
}

const E2EHarness = () => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [sentDrafts, setSentDrafts] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingChatAttachmentParams[]
  >([]);
  const [terminalEnabled, setTerminalEnabled] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("terminal=1"),
  );
  const [groupMode, setGroupMode] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("group=1"),
  );
  const activeConversation = groupMode ? e2eGroupConversation : e2eConversation;
  const activeConversationID = activeConversation.conversationID;
  const activeMessages = groupMode ? e2eGroupMessages : e2eMessages;
  const selectionActive = useMessageSelectionStore(
    (state) => state.activeConversationID === activeConversationID,
  );
  const selectionAnchorMessageID = useMessageSelectionStore(
    (state) => state.selectionAnchorMessageIDByConversation[activeConversationID],
  );
  const botDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.botDetectionEnabled,
  );
  const addPendingAgentRequest = usePendingAgentRequestStore(
    (state) => state.addRequest,
  );
  const selectionAnchorIndex = useMemo(() => {
    if (!selectionActive || activeMessages.length === 0) return -1;
    if (!selectionAnchorMessageID) return 0;

    return Math.max(
      0,
      activeMessages.findIndex(
        (message) => message.clientMsgID === selectionAnchorMessageID,
      ),
    );
  }, [activeMessages, selectionActive, selectionAnchorMessageID]);

  if (terminalEnabled) {
    installE2EElectronMock();
  }

  useEffect(() => {
    const syncTerminalFlag = () => {
      setTerminalEnabled(window.location.hash.includes("terminal=1"));
      setGroupMode(window.location.hash.includes("group=1"));
    };

    syncTerminalFlag();
    window.addEventListener("hashchange", syncTerminalFlag);

    return () => {
      window.removeEventListener("hashchange", syncTerminalFlag);
    };
  }, []);

  useEffect(() => {
    useUserStore.getState().updateSelfInfo({
      userID: "e2e_self",
      nickname: "E2E Self",
    });
    useConversationStore.setState({
      currentConversation: activeConversation,
      conversationList: [activeConversation],
    });
    if (terminalEnabled) {
      installE2EElectronMock();
    }
    useTerminalDockStore.getState().setPanelOpen(terminalEnabled);

    return () => {
      useMessageSelectionStore.getState().clearSelection(activeConversationID);
      useTerminalDockStore.getState().setPanelOpen(false);
    };
  }, [activeConversation, activeConversationID, terminalEnabled]);

  useEffect(() => {
    const handleAppendDraft = (value: string) => {
      setDraftText((current) => `${current}${current ? "\n" : ""}${value}`);
    };
    const handleReplaceDraft = (value: string) => {
      setDraftText(value);
    };
    const handleSendDraft = (value: string) => {
      setDraftText(value);
      setSentDrafts((current) => [...current, value]);
    };
    const handlePendingAttachment = (attachment: PendingChatAttachmentParams) => {
      setPendingAttachments((current) => [...current, attachment]);
    };

    emitter.on("APPEND_CHAT_INPUT", handleAppendDraft);
    emitter.on("REPLACE_CHAT_INPUT", handleReplaceDraft);
    emitter.on("SEND_CHAT_INPUT", handleSendDraft);
    emitter.on("ADD_PENDING_CHAT_ATTACHMENT", handlePendingAttachment);

    return () => {
      emitter.off("APPEND_CHAT_INPUT", handleAppendDraft);
      emitter.off("REPLACE_CHAT_INPUT", handleReplaceDraft);
      emitter.off("SEND_CHAT_INPUT", handleSendDraft);
      emitter.off("ADD_PENDING_CHAT_ATTACHMENT", handlePendingAttachment);
    };
  }, []);

  useEffect(() => {
    if (!botDetectionEnabled) return;

    const selfUserID = "e2e_self";
    const recentLimit = 20;
    const conversationType =
      activeConversation.conversationType === SessionType.Group ? "group" : "single";
    const autoInject = useTerminalDockStore.getState().autoInjectEnabled;

    activeMessages.forEach((message, index) => {
      if (message.sendID === selfUserID) return;
      if (isAgentGeneratedMessage(message)) return;

      const text = extractTextMessageContent(message);
      const trigger = detectBotTrigger({
        text,
        currentUserID: selfUserID,
        conversationType,
      });

      if (!trigger) return;

      // Only process triggers targeting this user (or no specific target).
      if (trigger.targetUserID && trigger.targetUserID !== selfUserID) return;

      const contextMessages = activeMessages.slice(
        Math.max(0, index - recentLimit + 1),
        index + 1,
      );

      const request = createPendingAgentRequest({
        conversationID: activeConversationID,
        triggerMessage: message,
        trigger,
        contextMessages,
        isGroup: conversationType === "group",
        recentLimit,
      });

      if (autoInject) {
        const terminalDockState = useTerminalDockStore.getState();
        const activeWorkspaceID = terminalDockState.activeWorkspaceID;
        const activeWorkspace = terminalDockState.workspaces.find(
          (workspace) => workspace.id === activeWorkspaceID,
        );
        const activeTabID = activeWorkspaceID
          ? terminalDockState.activeTabByWorkspace[activeWorkspaceID]
          : undefined;
        const activeTab = activeWorkspaceID
          ? terminalDockState.tabsByWorkspace[activeWorkspaceID]?.find(
              (tab) => tab.id === activeTabID,
            )
          : undefined;
        const canAutoInject =
          Boolean(
            activeWorkspace?.linkedConversationIDs.includes(activeConversationID),
          ) && Boolean(activeTab && activeTab.status === "running");

        if (!canAutoInject) {
          addPendingAgentRequest(request);
          return;
        }

        const triggerKey = `${activeConversationID}|${request.triggerMessageID}`;
        if (terminalDockState.hasHandledBotTrigger(triggerKey)) return;

        const existingRequest =
          usePendingAgentRequestStore
            .getState()
            .requestsByConversation[activeConversationID]?.some(
              (item) => item.triggerMessageID === request.triggerMessageID,
            ) ?? false;
        if (existingRequest) return;

        terminalDockState.markBotTriggerHandled(triggerKey);
        addPendingAgentRequest({ ...request, status: "sent" });
        emitter.emit("BOT_AGENT_REQUEST_ACTION", {
          request,
          action: "send",
        });
      } else {
        addPendingAgentRequest(request);
      }
    });
  }, [
    activeConversation.conversationType,
    activeConversationID,
    activeMessages,
    addPendingAgentRequest,
    botDetectionEnabled,
  ]);

  // When auto-inject is enabled, promote pending requests to sent.
  useEffect(() => {
    const autoInject = useTerminalDockStore.getState().autoInjectEnabled;
    if (!autoInject || !botDetectionEnabled) return;
    const terminalDockState = useTerminalDockStore.getState();
    const activeWorkspaceID = terminalDockState.activeWorkspaceID;
    const activeWorkspace = terminalDockState.workspaces.find(
      (workspace) => workspace.id === activeWorkspaceID,
    );
    const activeTabID = activeWorkspaceID
      ? terminalDockState.activeTabByWorkspace[activeWorkspaceID]
      : undefined;
    const activeTab = activeWorkspaceID
      ? terminalDockState.tabsByWorkspace[activeWorkspaceID]?.find(
          (tab) => tab.id === activeTabID,
        )
      : undefined;
    const canAutoInject =
      Boolean(activeWorkspace?.linkedConversationIDs.includes(activeConversationID)) &&
      Boolean(activeTab && activeTab.status === "running");

    if (!canAutoInject) return;

    const pendingRequests =
      usePendingAgentRequestStore.getState().requestsByConversation[
        activeConversationID
      ] ?? [];

    const pendingForSelf = pendingRequests.filter(
      (r) =>
        r.status === "pending" && (!r.targetUserID || r.targetUserID === "e2e_self"),
    );

    if (pendingForSelf.length === 0) return;

    usePendingAgentRequestStore.getState().promoteToAutoInject(activeConversationID);

    for (const request of pendingForSelf) {
      useTerminalDockStore
        .getState()
        .markBotTriggerHandled(`${activeConversationID}|${request.triggerMessageID}`);
      emitter.emit("BOT_AGENT_REQUEST_ACTION", {
        request,
        action: "send",
      });
    }
  }, [activeConversationID, botDetectionEnabled]);

  return (
    <div className="flex h-screen bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader onOpenHistory={() => setHistoryOpen(true)} />
        <div
          className="relative min-h-0 flex-1 overflow-auto"
          data-testid="e2e-chat-area"
        >
          {selectionActive && (
            <MessageSelectionToolbar conversationID={activeConversationID} />
          )}
          <PendingAgentRequests conversationID={activeConversationID} />
          {activeMessages.map((message, index) => (
            <div key={message.clientMsgID}>
              {selectionActive && index === selectionAnchorIndex && (
                <MessageSelectionBoundary
                  anchored={Boolean(selectionAnchorMessageID)}
                  onClick={() =>
                    useMessageSelectionStore
                      .getState()
                      .clearSelection(activeConversationID)
                  }
                />
              )}
              <MessageItem
                conversationID={activeConversationID}
                message={message}
                isSender={message.sendID === "e2e_self"}
                selectionVisible={!selectionActive || index >= selectionAnchorIndex}
              />
            </div>
          ))}
        </div>
        <MessageHistoryDrawer
          conversationID={activeConversationID}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
        <div className="border-t border-[#e5e7eb] bg-[#f8fafc] px-4 py-3">
          <div className="text-xs font-medium text-[#475467]">E2E Draft</div>
          <pre
            className="mt-2 min-h-[72px] whitespace-pre-wrap rounded border border-[#d0d5dd] bg-white p-2 text-xs text-[#101828]"
            data-testid="e2e-draft-preview"
          >
            {draftText}
          </pre>
          <div className="mt-2 text-xs font-medium text-[#475467]">E2E Sent Drafts</div>
          <pre
            className="mt-2 min-h-[48px] whitespace-pre-wrap rounded border border-[#d0d5dd] bg-white p-2 text-xs text-[#101828]"
            data-testid="e2e-sent-drafts"
          >
            {sentDrafts.join("\n---\n")}
          </pre>
          <div className="mt-2 text-xs font-medium text-[#475467]">
            E2E Pending Attachments
          </div>
          <div
            className="mt-2 min-h-[48px] rounded border border-[#d0d5dd] bg-white p-2 text-xs text-[#101828]"
            data-testid="e2e-pending-attachments"
          >
            {pendingAttachments.length === 0 ? (
              <div className="whitespace-pre-wrap" />
            ) : (
              pendingAttachments.map((attachment, index) => (
                <div
                  className="mb-2 flex items-center justify-between gap-2 last:mb-0"
                  key={`${attachment.filePath}-${index}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.fileName} | {attachment.relativePath} |{" "}
                    {attachment.sendKind}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-[#d0d5dd] px-2 py-1"
                    onClick={() =>
                      setPendingAttachments((current) =>
                        current.filter((_, currentIndex) => currentIndex !== index),
                      )
                    }
                    data-testid="chat-footer-remove-pending-attachment"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {terminalEnabled && (
        <div className="h-full w-[560px] shrink-0" data-testid="e2e-terminal-pane">
          <TerminalDock />
        </div>
      )}
    </div>
  );
};

export default E2EHarness;
