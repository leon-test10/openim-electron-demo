import "./terminalDock.css";

import {
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  ExportOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  type MessageItem as OIMMessageItem,
  MessageType,
  ViewType,
} from "@openim/wasm-client-sdk";
import { Button, Empty, Input, message, Modal, Tooltip } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore, useTerminalDockStore } from "@/store";
import { TerminalTab } from "@/store/type";
import { emit } from "@/utils/events";

import TerminalSurface, { TerminalSurfaceApi } from "./TerminalSurface";
import TerminalTabs from "./TerminalTabs";
import WorkspaceBar from "./WorkspaceBar";

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<\/p><p>/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

const formatMessageAsMarkdown = (msg: OIMMessageItem) => {
  const timestamp = msg.sendTime
    ? dayjs(msg.sendTime).format("YYYY-MM-DD HH:mm:ss")
    : "";
  const sender = msg.senderNickname ?? msg.sendID ?? "unknown";

  if (msg.contentType === MessageType.TextMessage) {
    return `- ${timestamp} **${sender}**: ${stripHtml(msg.textElem?.content)}`;
  }

  if (msg.contentType === MessageType.PictureMessage) {
    const url =
      msg.pictureElem?.snapshotPicture?.url ?? msg.pictureElem?.sourcePicture?.url;
    return `- ${timestamp} **${sender}**: [image] ${url ?? ""}`.trim();
  }

  const fileName = msg.fileElem?.fileName;
  const fileUrl = msg.fileElem?.sourceUrl;
  if (fileName || fileUrl) {
    return `- ${timestamp} **${sender}**: [file] ${fileName ?? ""} ${
      fileUrl ?? ""
    }`.trim();
  }

  return `- ${timestamp} **${sender}**: [messageType=${msg.contentType}]`;
};

const getTabStats = (tab?: TerminalTab) => {
  if (!tab) return "No terminal";
  return `${tab.shell} | ${tab.status}`;
};

const TerminalDock = () => {
  const { conversationID: routeConversationID } = useParams();
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const panelOpen = useTerminalDockStore((state) => state.panelOpen);
  const setPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);
  const workspaces = useTerminalDockStore((state) => state.workspaces);
  const activeWorkspaceID = useTerminalDockStore((state) => state.activeWorkspaceID);
  const tabsByWorkspace = useTerminalDockStore((state) => state.tabsByWorkspace);
  const activeTabByWorkspace = useTerminalDockStore(
    (state) => state.activeTabByWorkspace,
  );
  const outputByTab = useTerminalDockStore((state) => state.outputByTab);
  const lastContextPromptByWorkspace = useTerminalDockStore(
    (state) => state.lastContextPromptByWorkspace,
  );
  const createWorkspace = useTerminalDockStore((state) => state.createWorkspace);
  const setActiveWorkspace = useTerminalDockStore((state) => state.setActiveWorkspace);
  const linkConversationToWorkspace = useTerminalDockStore(
    (state) => state.linkConversationToWorkspace,
  );
  const createTab = useTerminalDockStore((state) => state.createTab);
  const setActiveTab = useTerminalDockStore((state) => state.setActiveTab);
  const startTab = useTerminalDockStore((state) => state.startTab);
  const restartTab = useTerminalDockStore((state) => state.restartTab);
  const interruptTab = useTerminalDockStore((state) => state.interruptTab);
  const stopTab = useTerminalDockStore((state) => state.stopTab);
  const writeToTab = useTerminalDockStore((state) => state.writeToTab);
  const clearTabOutput = useTerminalDockStore((state) => state.clearTabOutput);
  const removeTab = useTerminalDockStore((state) => state.removeTab);
  const handleTerminalEvent = useTerminalDockStore(
    (state) => state.handleTerminalEvent,
  );
  const setLastContextPrompt = useTerminalDockStore(
    (state) => state.setLastContextPrompt,
  );

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const terminalApisRef = useRef<Map<string, TerminalSurfaceApi>>(new Map());
  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceID),
    [activeWorkspaceID, workspaces],
  );
  const tabs = activeWorkspaceID ? tabsByWorkspace[activeWorkspaceID] ?? [] : [];
  const activeTabID = activeWorkspaceID
    ? activeTabByWorkspace[activeWorkspaceID]
    : undefined;
  const activeTab = tabs.find((tab) => tab.id === activeTabID) ?? tabs[0];
  const terminalAvailable = Boolean(window.electronAPI);
  const lastContextPrompt = activeWorkspaceID
    ? lastContextPromptByWorkspace[activeWorkspaceID]
    : undefined;

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("terminal:event", handleTerminalEvent);
  }, [handleTerminalEvent]);

  useEffect(() => {
    if (!activeWorkspaceID || activeTabID || tabs.length === 0) return;
    setActiveTab(activeWorkspaceID, tabs[0].id);
  }, [activeTabID, activeWorkspaceID, setActiveTab, tabs]);

  if (!panelOpen) return null;

  const onCreateWorkspace = async () => {
    const workspaceID = await createWorkspace(workspaceTitle.trim() || undefined);
    setWorkspaceModalOpen(false);
    setWorkspaceTitle("");
    if (!workspaceID) {
      message.error("Failed to create workspace");
    }
  };

  const onCreateTab = async () => {
    if (!activeWorkspace) return;
    const tabID = await createTab(activeWorkspace.id);
    if (tabID) await startTab(tabID);
  };

  const copyWorkspacePath = async () => {
    if (!activeWorkspace) return;
    await navigator.clipboard.writeText(activeWorkspace.rootPath);
    message.success("Workspace path copied");
  };

  const openWorkspaceFolder = async () => {
    if (!activeWorkspace || !window.electronAPI) return;
    const result = await window.electronAPI.ipcInvoke<string>(
      "terminal:openWorkspace",
      activeWorkspace.id,
    );
    if (result) message.warning(result);
  };

  const exportConversationContext = async () => {
    if (!activeWorkspace || !conversationID || !window.electronAPI) {
      return undefined;
    }

    linkConversationToWorkspace(activeWorkspace.id, conversationID);
    const conversationIDs = Array.from(
      new Set([...activeWorkspace.linkedConversationIDs, conversationID]),
    );
    const exportedFiles: string[] = [];

    for (const linkedConversationID of conversationIDs) {
      const { data } = await IMSDK.getAdvancedHistoryMessageList({
        count: 50,
        startClientMsgID: "",
        conversationID: linkedConversationID,
        viewType: ViewType.History,
      });
      const timestamp = dayjs().format("YYYYMMDD-HHmmss");
      const historyPath = `context/${linkedConversationID}/history-${timestamp}.md`;
      const manifestPath = `context/${linkedConversationID}/attachments-manifest-${timestamp}.json`;
      const nonTextMessages = data.messageList
        .filter((item) => item.contentType !== MessageType.TextMessage)
        .map((item) => ({
          clientMsgID: item.clientMsgID,
          contentType: item.contentType,
          sendTime: item.sendTime,
          senderNickname: item.senderNickname,
        }));
      const markdown = [
        `# OpenIM Context`,
        ``,
        `- workspace: ${activeWorkspace.rootPath}`,
        `- conversationID: ${linkedConversationID}`,
        `- exportedAt: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`,
        ``,
        `## Messages`,
        ``,
        ...data.messageList.map(formatMessageAsMarkdown),
        ``,
      ].join("\n");

      await window.electronAPI.ipcInvoke("workspace:writeWorkspaceFile", {
        workspaceID: activeWorkspace.id,
        relativePath: historyPath,
        content: markdown,
      });
      await window.electronAPI.ipcInvoke("workspace:writeWorkspaceFile", {
        workspaceID: activeWorkspace.id,
        relativePath: manifestPath,
        content: JSON.stringify(nonTextMessages, null, 2),
      });
      exportedFiles.push(historyPath, manifestPath);
    }

    const prompt = [
      `# OpenIM Context`,
      ``,
      `Workspace: ${activeWorkspace.rootPath}`,
      ``,
      `Use these exported files as the current IM context:`,
      ``,
      ...exportedFiles.map((file) => `- ./${file}`),
      ``,
      `OpenIM is only providing terminal, workspace, and context files. The CLI runtime owns its own session, tools, permissions, model config, and memory.`,
      ``,
    ].join("\n");

    setLastContextPrompt(activeWorkspace.id, prompt);
    await navigator.clipboard.writeText(prompt);
    message.success("Context exported and prompt copied");
    return prompt;
  };

  const pasteContextPrompt = async () => {
    if (!activeTab || !lastContextPrompt) return;
    await writeToTab(activeTab.id, `${lastContextPrompt}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
  };

  const exportContextToTerminal = async () => {
    if (!activeTab) return;
    const prompt = (await exportConversationContext()) ?? lastContextPrompt;
    if (!prompt) {
      message.warning("No IM context available");
      return;
    }
    await writeToTab(activeTab.id, `${prompt}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
  };

  const selectionToIM = () => {
    if (!activeTab) return;
    const selection = terminalApisRef.current.get(activeTab.id)?.getSelectionText();
    if (!selection?.trim()) {
      message.info("No terminal selection");
      return;
    }

    emit("APPEND_CHAT_INPUT", selection.trim());
    message.success("Selection added to IM input");
  };

  return (
    <aside className="terminal-dock">
      <div className="terminal-dock-header">
        <div className="flex min-w-0 items-center gap-2">
          <CodeOutlined className="text-[#89d185]" rev={undefined} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[#ffffff]">
              Terminal
            </div>
            <div className="truncate text-[11px] text-[#9d9d9d]">
              {activeWorkspace?.title ?? "No workspace"}
            </div>
          </div>
        </div>
        <Tooltip title="Close Terminal">
          <Button
            type="text"
            size="small"
            className="terminal-dock-icon-button"
            icon={<CloseOutlined rev={undefined} />}
            onClick={() => setPanelOpen(false)}
          />
        </Tooltip>
      </div>

      <WorkspaceBar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        disabled={!terminalAvailable}
        onCreateWorkspace={() => setWorkspaceModalOpen(true)}
        onChangeWorkspace={setActiveWorkspace}
        onOpenWorkspace={() => void openWorkspaceFolder()}
        onCopyPath={() => void copyWorkspacePath()}
        onExportContext={() => void exportConversationContext()}
      />

      <div className="terminal-dock-toolbar">
        <Tooltip title="Start">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab || activeTab.status === "running"}
            icon={<PlayCircleOutlined rev={undefined} />}
            onClick={() => activeTab && void startTab(activeTab.id)}
          />
        </Tooltip>
        <Tooltip title="Restart">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab}
            icon={<ReloadOutlined rev={undefined} />}
            onClick={() => activeTab && void restartTab(activeTab.id)}
          />
        </Tooltip>
        <Tooltip title="Interrupt">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab || activeTab.status !== "running"}
            icon={<PauseCircleOutlined rev={undefined} />}
            onClick={() => activeTab && void interruptTab(activeTab.id)}
          />
        </Tooltip>
        <Tooltip title="Stop">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab || activeTab.status !== "running"}
            icon={<StopOutlined rev={undefined} />}
            onClick={() => activeTab && void stopTab(activeTab.id)}
          />
        </Tooltip>
        <Tooltip title="Export current IM context and paste prompt into terminal">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab || !activeWorkspace || !conversationID}
            icon={<SendOutlined rev={undefined} />}
            onClick={() => void exportContextToTerminal()}
          >
            Context -&gt; Terminal
          </Button>
        </Tooltip>
        <Tooltip title="Paste last copied context prompt">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab || !lastContextPrompt}
            icon={<ExportOutlined rev={undefined} />}
            onClick={() => void pasteContextPrompt()}
          />
        </Tooltip>
        <Tooltip title="Selection to IM Input">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab}
            icon={<CopyOutlined rev={undefined} />}
            onClick={selectionToIM}
          />
        </Tooltip>
        <Tooltip title="Clear Terminal">
          <Button
            size="small"
            type="text"
            className="terminal-dock-icon-button"
            disabled={!activeTab}
            icon={<ExportOutlined rev={undefined} />}
            onClick={() => activeTab && clearTabOutput(activeTab.id)}
          />
        </Tooltip>
      </div>

      {activeWorkspace ? (
        <>
          <TerminalTabs
            tabs={tabs}
            activeTabID={activeTab?.id}
            onAdd={() => void onCreateTab()}
            onSelect={(tabID) => setActiveTab(activeWorkspace.id, tabID)}
            onClose={(tabID) => void removeTab(activeWorkspace.id, tabID)}
          />
          <div className="min-h-0 flex-1 bg-[#1e1e1e]">
            {activeTab ? (
              <TerminalSurface
                tab={activeTab}
                output={outputByTab[activeTab.id] ?? []}
                onReady={(tabID, api) => {
                  if (!api) {
                    terminalApisRef.current.delete(tabID);
                    return;
                  }
                  terminalApisRef.current.set(tabID, api);
                }}
              />
            ) : (
              <div className="terminal-dock-empty">
                <div>
                  <div className="text-sm text-[#cccccc]">No terminal tab</div>
                  <Button
                    className="mt-3"
                    size="small"
                    type="primary"
                    onClick={() => void onCreateTab()}
                  >
                    New Terminal
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="terminal-dock-empty">
          {!terminalAvailable ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Terminal is available only in the Electron client"
            />
          ) : (
            <div>
              <div className="text-sm text-[#cccccc]">No workspace</div>
              <div className="mt-1 text-xs text-[#9d9d9d]">
                Create a workspace to run CLI agents in a terminal.
              </div>
              <Button
                className="mt-3"
                size="small"
                type="primary"
                onClick={() => setWorkspaceModalOpen(true)}
              >
                New Workspace
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="terminal-dock-status">
        <span className="truncate">{activeWorkspace?.rootPath ?? "No workspace"}</span>
        <span className="shrink-0">{getTabStats(activeTab)}</span>
      </div>

      <Modal
        title="New Workspace"
        open={workspaceModalOpen}
        onCancel={() => setWorkspaceModalOpen(false)}
        onOk={() => void onCreateWorkspace()}
        okButtonProps={{ disabled: !terminalAvailable }}
      >
        <Input
          autoFocus
          placeholder="Workspace name"
          value={workspaceTitle}
          onChange={(event) => setWorkspaceTitle(event.target.value)}
          onPressEnter={() => void onCreateWorkspace()}
        />
      </Modal>
    </aside>
  );
};

export default TerminalDock;
