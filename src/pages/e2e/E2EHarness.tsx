import { Platform, SessionType } from "@openim/wasm-client-sdk";
import { Modal, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";

import TerminalDock from "@/components/TerminalDock";
import { DEFAULT_AGENT_TERMINAL_PROMPT_TEMPLATE } from "@/services/agentRunContract";
import {
  type BotTargetCandidate,
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
      mtimeMs?: number;
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
    __e2eSentAttachments?: PendingChatAttachmentParams[];
    __e2eFileActions?: Array<{
      channel: string;
      nativePath?: string;
      sourceUrl?: string;
      fileName?: string;
      saveAs?: boolean;
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
  e2eWindow.__e2eSentAttachments = [];
  e2eWindow.__e2eFileActions = [];
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

  const createMockFile = (filePath: string, content?: string) => {
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
    return new File([content ?? `e2e fixture for ${fileName}`], fileName, { type });
  };

  const getWorkspaceRelativePathFromAbsolute = (filePath: string) => {
    const normalizedRoot = `${workspaceRoot}\\`.toLowerCase();
    const normalizedPath = filePath.toLowerCase();
    if (!normalizedPath.startsWith(normalizedRoot)) return undefined;
    const withoutRoot = filePath.slice(normalizedRoot.length);
    const parts = withoutRoot.split(/[\\/]/);
    parts.shift();
    return parts.join("/");
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
          mtimeMs?: number;
        };
        e2eWindow.__e2eWorkspaceWrites?.push({
          ...params,
          mtimeMs: params.mtimeMs ?? Date.now(),
        });
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

      if (channel === "workspace:statFile") {
        const relativePath = args[1] as string | undefined;
        const writes = e2eWindow.__e2eWorkspaceWrites ?? [];
        let matchingWrite:
          | { relativePath?: string; content?: string; mtimeMs?: number }
          | undefined;
        let matchingIndex = -1;
        for (let index = writes.length - 1; index >= 0; index -= 1) {
          if (writes[index].relativePath === relativePath) {
            matchingWrite = writes[index];
            matchingIndex = index;
            break;
          }
        }
        if (!matchingWrite) {
          return Promise.resolve({
            exists: false,
            isFile: false,
            isDirectory: false,
            size: 0,
            mtimeMs: 0,
          } as T);
        }
        const isDirectory = Boolean(matchingWrite.relativePath?.endsWith("/"));
        return Promise.resolve({
          exists: true,
          isFile: !isDirectory,
          isDirectory,
          size: matchingWrite.content?.length ?? 0,
          // Keep mtime stable per write index so auto-send de-duping is deterministic.
          mtimeMs: matchingWrite.mtimeMs ?? 1_700_000_000_000 + matchingIndex,
        } as T);
      }

      if (channel === "folder:scan") {
        const params = args[0] as {
          nativePath?: string;
          folderName?: string;
          relativePath?: string;
        };
        const folderPath =
          params.relativePath?.replace(/[\\/]+$/, "") ?? params.folderName ?? "";
        const nativeRoot = params.nativePath?.replace(/[\\/]+$/, "");
        const files = params.nativePath
          ? [
              {
                relativePath: "nested.txt",
                fileName: "nested.txt",
                nativePath: `${nativeRoot}\\nested.txt`,
                size: 21,
              },
            ]
          : (e2eWindow.__e2eWorkspaceWrites ?? [])
              .filter(
                (write) =>
                  write.relativePath?.startsWith(`${folderPath}/`) &&
                  !write.relativePath.endsWith("/"),
              )
              .map((write) => {
                const relativePath = write.relativePath!.slice(folderPath.length + 1);
                return {
                  relativePath,
                  fileName: relativePath.split("/").pop() ?? relativePath,
                  nativePath: `C:\\OpenIM-E2E\\workspace\\${write.relativePath}`,
                  size: write.content?.length ?? 0,
                };
              });
        return Promise.resolve({
          folderName: params.folderName ?? folderPath.split("/").pop() ?? "folder",
          itemCount: files.length,
          totalSize: files.reduce((sum, file) => sum + file.size, 0),
          files,
        } as T);
      }

      if (channel === "file:selectFolder") {
        return Promise.resolve({
          folderPath: "C:\\OpenIM-E2E\\fixtures\\skills",
          folderName: "skills",
        } as T);
      }

      if (channel === "folder:downloadAllResources") {
        e2eWindow.__e2eFileActions?.push({
          channel,
          nativePath: "C:\\OpenIM-E2E\\downloads\\skills",
        });
        return Promise.resolve("C:\\OpenIM-E2E\\downloads\\skills" as T);
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

      if (channel === "file:openPath") {
        e2eWindow.__e2eFileActions?.push({
          channel,
          nativePath: args[0] as string,
        });
        return Promise.resolve("" as T);
      }

      if (channel === "file:showItemInFolder") {
        e2eWindow.__e2eFileActions?.push({
          channel,
          nativePath: args[0] as string,
        });
        return Promise.resolve(true as T);
      }

      if (channel === "file:downloadToLocal") {
        const params = args[0] as {
          sourceUrl?: string;
          fileName?: string;
          saveAs?: boolean;
        };
        const nativePath = `C:\\OpenIM-E2E\\downloads\\${
          params.fileName ?? "download"
        }`;
        e2eWindow.__e2eFileActions?.push({
          channel,
          nativePath,
          sourceUrl: params.sourceUrl,
          fileName: params.fileName,
          saveAs: params.saveAs,
        });
        return Promise.resolve(nativePath as T);
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
    getFileByPath: (filePath: string) => {
      const relativePath = getWorkspaceRelativePathFromAbsolute(filePath);
      const workspaceWrite = relativePath
        ? [...(e2eWindow.__e2eWorkspaceWrites ?? [])]
            .reverse()
            .find((write) => write.relativePath === relativePath)
        : undefined;
      return Promise.resolve(createMockFile(filePath, workspaceWrite?.content));
    },
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
  const setBotDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.setBotDetectionEnabled,
  );
  const addPendingAgentRequest = usePendingAgentRequestStore(
    (state) => state.addRequest,
  );
  const autoInjectEnabled = useTerminalDockStore((state) => state.autoInjectEnabled);
  const autoReplyTextEnabled = useTerminalDockStore(
    (state) => state.autoReplyTextEnabled,
  );
  const autoFileAttachmentEnabled = useTerminalDockStore(
    (state) => state.autoFileAttachmentEnabled,
  );
  const setAutoInjectEnabled = useTerminalDockStore(
    (state) => state.setAutoInjectEnabled,
  );
  const setAutoReplyTextEnabled = useTerminalDockStore(
    (state) => state.setAutoReplyTextEnabled,
  );
  const setAutoFileAttachmentEnabled = useTerminalDockStore(
    (state) => state.setAutoFileAttachmentEnabled,
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

  const onAutoInjectChange = (checked: boolean) => {
    if (!checked) {
      setAutoInjectEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Auto Inject?",
      content:
        "Auto Inject is experimental. Remote IM messages may trigger prompts to be injected into your local terminal.",
      okText: "Enable Auto Inject",
      cancelText: "Cancel",
      onOk: () => {
        setBotDetectionEnabled(true);
        setAutoInjectEnabled(true);
      },
    });
  };

  const onAutoReplyTextChange = (checked: boolean) => {
    if (!checked) {
      setAutoReplyTextEnabled(false);
      return;
    }
    Modal.confirm({
      title: "Enable Auto Reply Text?",
      content: "Auto Reply Text is experimental.",
      okText: "Enable Auto Reply Text",
      cancelText: "Cancel",
      onOk: () => setAutoReplyTextEnabled(true),
    });
  };

  const onAutoFileAttachmentChange = (checked: boolean) => {
    if (!checked) {
      setAutoFileAttachmentEnabled(false);
      return;
    }
    Modal.confirm({
      title: "Enable Auto File Attachment?",
      content: "Auto File Attachment is experimental.",
      okText: "Enable Auto File Attachment",
      cancelText: "Cancel",
      onOk: () => setAutoFileAttachmentEnabled(true),
    });
  };
  const selfMentionTemplate = "@bot @E2E Self";
  const insertSelfBotMention = () => {
    setDraftText((current) => {
      const separator = current && !current.endsWith(" ") ? " " : "";
      return `${current}${separator}${selfMentionTemplate} `;
    });
  };

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
    const terminalDockState = useTerminalDockStore.getState();
    terminalDockState.setAgentPromptTemplate(DEFAULT_AGENT_TERMINAL_PROMPT_TEMPLATE);
    terminalDockState.setPanelOpen(terminalEnabled);

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
      setPendingAttachments((current) => {
        (
          window as unknown as {
            __e2eSentAttachments?: PendingChatAttachmentParams[];
          }
        ).__e2eSentAttachments?.push(...current);
        return [];
      });
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
    const terminalDockState = useTerminalDockStore.getState();
    const recentLimit = terminalDockState.botContextMessageLimit;
    const conversationType =
      activeConversation.conversationType === SessionType.Group ? "group" : "single";
    const autoInject = terminalDockState.autoInjectEnabled;
    const rawTargetCandidates: Array<BotTargetCandidate | undefined> = [
      {
        userID: selfUserID,
        nickname: "E2E Self",
      },
      activeConversation.conversationType === SessionType.Single
        ? {
            userID: activeConversation.userID,
            nickname: activeConversation.showName,
          }
        : undefined,
    ];
    const targetCandidates = rawTargetCandidates.filter(
      (candidate): candidate is BotTargetCandidate => Boolean(candidate?.userID),
    );

    // Scan backwards to find the latest unhandled trigger.
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      const message = activeMessages[index];
      if (isAgentGeneratedMessage(message)) continue;

      const text = extractTextMessageContent(message);
      const trigger = detectBotTrigger({
        text,
        currentUserID: selfUserID,
        conversationType,
        targetCandidates,
      });

      if (!trigger) continue;

      // Only process triggers explicitly targeting this user.
      if (trigger.targetUserID && trigger.targetUserID !== selfUserID) continue;

      const triggerKey = `${activeConversationID}|${message.clientMsgID}`;
      if (terminalDockState.hasHandledBotTrigger(triggerKey)) continue;

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
          terminalDockState.markBotTriggerHandled(triggerKey);
          addPendingAgentRequest(request);
          break;
        }

        terminalDockState.markBotTriggerHandled(triggerKey);
        addPendingAgentRequest({ ...request, status: "sent" });
        emitter.emit("BOT_AGENT_REQUEST_ACTION", { request, action: "send" });
      } else {
        terminalDockState.markBotTriggerHandled(triggerKey);
        addPendingAgentRequest(request);
      }

      // Only process the latest unhandled trigger per scan.
      break;
    }
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
          <div
            className="mb-3 flex flex-wrap items-center gap-3 rounded border border-[#e5e7eb] bg-white px-3 py-2 text-xs text-[#475467]"
            data-testid="chat-agent-automation-bar"
          >
            <span className="font-medium text-[#344054]">Agent automation</span>
            <button
              type="button"
              className="rounded px-1 text-xs text-[#175cd3]"
              onClick={insertSelfBotMention}
              data-testid="chat-agent-mention-insert"
            >
              Use {selfMentionTemplate}
            </button>
            <label className="flex items-center gap-1">
              <span>Auto Inject</span>
              <Switch
                size="small"
                checked={autoInjectEnabled}
                onChange={onAutoInjectChange}
                data-testid="terminal-auto-inject-toggle"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>Auto Reply Text</span>
              <Switch
                size="small"
                checked={autoReplyTextEnabled}
                onChange={onAutoReplyTextChange}
                data-testid="terminal-auto-reply-toggle"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>Auto File Attach</span>
              <Switch
                size="small"
                checked={autoFileAttachmentEnabled}
                onChange={onAutoFileAttachmentChange}
                data-testid="terminal-auto-file-attach-toggle"
              />
            </label>
            <span className="text-[#98a2b3]" data-testid="chat-agent-automation-state">
              {botDetectionEnabled ||
              autoInjectEnabled ||
              autoReplyTextEnabled ||
              autoFileAttachmentEnabled
                ? "enabled"
                : "off"}
            </span>
          </div>
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
                  key={String(
                    attachment.nativePath || attachment.relativePath || index,
                  )}
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
