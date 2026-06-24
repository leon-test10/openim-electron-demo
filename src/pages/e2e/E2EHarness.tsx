import { Platform } from "@openim/wasm-client-sdk";
import { useEffect, useState } from "react";

import TerminalDock from "@/components/TerminalDock";
import {
  useConversationStore,
  useMessageSelectionStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import { e2eConversation, e2eConversationID, e2eMessages } from "@/utils/e2eMockData";

import ChatHeader from "../chat/queryChat/ChatHeader";
import MessageHistoryDrawer from "../chat/queryChat/MessageHistoryDrawer";
import MessageItem from "../chat/queryChat/MessageItem";
import MessageSelectionToolbar from "../chat/queryChat/MessageSelectionToolbar";

const installE2EElectronMock = () => {
  if (typeof window === "undefined" || window.electronAPI) return;

  const subscribers = new Map<string, Set<(...args: unknown[]) => void>>();
  const workspaceRoot = "C:\\OpenIM-E2E\\workspaces";
  const e2eWindow = window as unknown as {
    __e2eTerminalWrites?: string[];
    __e2eWorkspaceWrites?: Array<{
      relativePath?: string;
      content?: string;
    }>;
  };
  e2eWindow.__e2eTerminalWrites = [];
  e2eWindow.__e2eWorkspaceWrites = [];

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
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:write") {
        const params = args[0] as { data?: string };
        e2eWindow.__e2eTerminalWrites?.push(params.data ?? "");
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "workspace:writeWorkspaceFile") {
        const params = args[0] as { relativePath?: string; content?: string };
        e2eWindow.__e2eWorkspaceWrites?.push(params);
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "terminal:resize" || channel === "terminal:interrupt") {
        result = { ok: true };
        return Promise.resolve(result as T);
      }

      if (channel === "workspace:copyWorkspaceFile") {
        const params = args[0] as { relativePath: string };
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
        return Promise.resolve(undefined as T);
      }

      if (channel === "terminal:openWorkspace") {
        result = "";
        return Promise.resolve(result as T);
      }

      return Promise.resolve(undefined as T);
    },
    ipcSendSync: <T,>() => undefined as T,
    saveFileToDisk: () => Promise.resolve(""),
    getFileByPath: () => Promise.resolve(null),
  };
};

const E2EHarness = () => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [terminalEnabled, setTerminalEnabled] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("terminal=1"),
  );
  const selectionActive = useMessageSelectionStore(
    (state) => state.activeConversationID === e2eConversationID,
  );

  useEffect(() => {
    const syncTerminalFlag = () => {
      setTerminalEnabled(window.location.hash.includes("terminal=1"));
    };

    syncTerminalFlag();
    window.addEventListener("hashchange", syncTerminalFlag);

    return () => {
      window.removeEventListener("hashchange", syncTerminalFlag);
    };
  }, []);

  useEffect(() => {
    useUserStore.setState((state) => ({
      ...state,
      selfInfo: {
        ...state.selfInfo,
        userID: "e2e_self",
        nickname: "E2E Self",
      },
    }));
    useConversationStore.setState({
      currentConversation: e2eConversation,
      conversationList: [e2eConversation],
    });
    if (terminalEnabled) {
      installE2EElectronMock();
    }
    useTerminalDockStore.getState().setPanelOpen(terminalEnabled);

    return () => {
      useMessageSelectionStore.getState().clearSelection(e2eConversationID);
      useTerminalDockStore.getState().setPanelOpen(false);
    };
  }, [terminalEnabled]);

  return (
    <div className="flex h-screen bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader onOpenHistory={() => setHistoryOpen(true)} />
        <div
          className="relative min-h-0 flex-1 overflow-auto"
          data-testid="e2e-chat-area"
        >
          {selectionActive && (
            <MessageSelectionToolbar conversationID={e2eConversationID} />
          )}
          {e2eMessages.map((message) => (
            <MessageItem
              key={message.clientMsgID}
              conversationID={e2eConversationID}
              message={message}
              isSender={message.sendID === "e2e_self"}
            />
          ))}
        </div>
        <MessageHistoryDrawer
          conversationID={e2eConversationID}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
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
