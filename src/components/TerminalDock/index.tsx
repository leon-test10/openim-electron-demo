import "./terminalDock.css";

import {
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  type MessageItem as OIMMessageItem,
  MessageType,
  ViewType,
} from "@openim/wasm-client-sdk";
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Switch,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore, useTerminalDockStore } from "@/store";
import { TerminalTab } from "@/store/type";
import { emit } from "@/utils/events";

import TerminalSurface, { TerminalSurfaceApi } from "./TerminalSurface";
import TerminalTabs from "./TerminalTabs";
import WorkspaceBar from "./WorkspaceBar";

type ContextExportResult = {
  prompt: string;
  files: string[];
};

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

const RECENT_SELECTION_TTL = 60_000;
const AUTO_CAPTURE_DEBOUNCE = 1200;

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
  const commandTemplates = useTerminalDockStore((state) => state.commandTemplates);
  const autoReceiveEnabled = useTerminalDockStore((state) => state.autoReceiveEnabled);
  const autoSendEnabled = useTerminalDockStore((state) => state.autoSendEnabled);
  const captureSource = useTerminalDockStore((state) => state.captureSource);
  const lastCapturedTextByTab = useTerminalDockStore(
    (state) => state.lastCapturedTextByTab,
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
  const updateCommandTemplate = useTerminalDockStore(
    (state) => state.updateCommandTemplate,
  );
  const addCommandTemplate = useTerminalDockStore((state) => state.addCommandTemplate);
  const removeCommandTemplate = useTerminalDockStore(
    (state) => state.removeCommandTemplate,
  );
  const resetCommandTemplates = useTerminalDockStore(
    (state) => state.resetCommandTemplates,
  );
  const setAutoReceiveEnabled = useTerminalDockStore(
    (state) => state.setAutoReceiveEnabled,
  );
  const setAutoSendEnabled = useTerminalDockStore((state) => state.setAutoSendEnabled);
  const setLastCapturedText = useTerminalDockStore(
    (state) => state.setLastCapturedText,
  );

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const terminalApisRef = useRef<Map<string, TerminalSurfaceApi>>(new Map());
  const recentTerminalSelectionsRef = useRef<
    Map<string, { text: string; updatedAt: number }>
  >(new Map());
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
  const activeTabOutput = activeTab ? outputByTab[activeTab.id] ?? [] : [];
  const activeTabOutputSignature = useMemo(
    () => activeTabOutput.map((item) => item.id).join("|"),
    [activeTabOutput],
  );

  const captureTerminalOutput = useCallback(
    (mode: "manual" | "auto") => {
      if (!activeTab) return;

      const api = terminalApisRef.current.get(activeTab.id);
      if (!api) {
        if (mode === "manual") message.info("No active terminal surface");
        return;
      }

      const visibleText = api.getVisibleText();
      const recentOutputText = api.getRecentOutputText();
      const capturedText =
        captureSource === "screen"
          ? visibleText
          : captureSource === "raw"
          ? recentOutputText
          : visibleText.length >= 12
          ? visibleText
          : recentOutputText;
      const normalizedText = capturedText.trim();

      if (!normalizedText) {
        if (mode === "manual") {
          message.info("No terminal output captured");
        }
        return;
      }

      if (lastCapturedTextByTab[activeTab.id] === normalizedText) {
        if (mode === "manual") {
          message.info("Terminal output already captured");
        }
        return;
      }

      setLastCapturedText(activeTab.id, normalizedText);
      if (autoReceiveEnabled && autoSendEnabled) {
        emit("SEND_CHAT_INPUT", normalizedText);
        message.success("Terminal output sent to IM");
        return;
      }

      emit("REPLACE_CHAT_INPUT", normalizedText);
      message.success("Terminal output captured to IM input");
    },
    [
      activeTab,
      autoReceiveEnabled,
      autoSendEnabled,
      captureSource,
      lastCapturedTextByTab,
      setLastCapturedText,
    ],
  );

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("terminal:event", handleTerminalEvent);
  }, [handleTerminalEvent]);

  useEffect(() => {
    if (!activeWorkspaceID || activeTabID || tabs.length === 0) return;
    setActiveTab(activeWorkspaceID, tabs[0].id);
  }, [activeTabID, activeWorkspaceID, setActiveTab, tabs]);

  useEffect(() => {
    if (!autoReceiveEnabled || !activeTab || !activeTabOutputSignature) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      captureTerminalOutput("auto");
    }, AUTO_CAPTURE_DEBOUNCE);

    return () => window.clearTimeout(timer);
  }, [activeTab, activeTabOutputSignature, autoReceiveEnabled, captureTerminalOutput]);

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

  const onRunCommandTemplate = async (templateID: string) => {
    if (!activeWorkspace) return;
    const template = commandTemplates.find((item) => item.id === templateID);
    if (!template?.command.trim()) {
      message.warning("Command template is empty");
      return;
    }

    const tabID = await createTab(activeWorkspace.id, {
      title: template.id === "opencode" ? "opencode" : template.title,
    });
    if (!tabID) return;

    try {
      await startTab(tabID);
      await writeToTab(tabID, `${template.command.trim()}\r\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(errorMessage);
    }
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

  const exportConversationContext = async (): Promise<
    ContextExportResult | undefined
  > => {
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

    const prompt = `Use the OpenIM context exported in this workspace. Workspace: ${
      activeWorkspace.rootPath
    }. Context files: ${exportedFiles
      .map((file) => `./${file}`)
      .join(
        "; ",
      )}. OpenIM only provides terminal, workspace, and context files; the CLI runtime owns its own session, tools, permissions, model config, and memory.`;

    setLastContextPrompt(activeWorkspace.id, prompt);
    await navigator.clipboard.writeText(prompt);
    message.success("Context exported and prompt copied");
    return { prompt, files: exportedFiles };
  };

  const pasteContextPrompt = async () => {
    if (!activeTab || !lastContextPrompt) return;
    await writeToTab(activeTab.id, `${lastContextPrompt}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
  };

  const copyContextPrompt = async () => {
    const result = await exportConversationContext();
    const prompt = result?.prompt ?? lastContextPrompt;
    if (!prompt) {
      message.warning("No IM context available");
      return;
    }
    await navigator.clipboard.writeText(prompt);
    message.success("Context prompt copied");
  };

  const selectionToIM = () => {
    if (!activeTab) return;
    const browserSelection = window.getSelection()?.toString();
    const terminalSelection = terminalApisRef.current
      .get(activeTab.id)
      ?.getSelectionText();
    const recentSelection = recentTerminalSelectionsRef.current.get(activeTab.id);
    const recentSelectionText =
      recentSelection && Date.now() - recentSelection.updatedAt < RECENT_SELECTION_TTL
        ? recentSelection.text
        : "";
    const selection = browserSelection || terminalSelection || recentSelectionText;
    if (!selection?.trim()) {
      message.info("No terminal selection");
      return;
    }

    emit("APPEND_CHAT_INPUT", selection.trim());
    message.success("Selection added to IM input");
  };

  const runMenuItems = [
    ...commandTemplates
      .filter((template) => template.enabled)
      .map((template) => ({
        key: `template:${template.id}`,
        label: template.title,
      })),
    { type: "divider" as const },
    {
      key: "powershell",
      label: "Run PowerShell",
    },
    {
      key: "new-terminal",
      label: "New Terminal",
    },
    { type: "divider" as const },
    {
      key: "templates",
      label: "Command Templates",
      icon: <SettingOutlined rev={undefined} />,
    },
  ];

  const onRunMenuClick = ({ key }: { key: string }) => {
    if (key.startsWith("template:")) {
      void onRunCommandTemplate(key.replace("template:", ""));
      return;
    }

    if (key === "powershell" || key === "new-terminal") {
      void onCreateTab();
      return;
    }

    if (key === "templates") {
      setCommandModalOpen(true);
    }
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
        <Dropdown
          menu={{
            items: runMenuItems,
            onClick: onRunMenuClick,
          }}
          trigger={["click"]}
          disabled={!terminalAvailable || !activeWorkspace}
        >
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!terminalAvailable || !activeWorkspace}
            icon={<PlayCircleOutlined rev={undefined} />}
          >
            Run <DownOutlined rev={undefined} />
          </Button>
        </Dropdown>
        <Tooltip title="Start selected terminal">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab || activeTab.status === "running"}
            icon={<PlayCircleOutlined rev={undefined} />}
            onClick={() => activeTab && void startTab(activeTab.id)}
          >
            Start
          </Button>
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
        <Tooltip title="Export current IM context files and copy a short prompt">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeWorkspace || !conversationID}
            icon={<FileTextOutlined rev={undefined} />}
            onClick={() => void copyContextPrompt()}
          >
            Copy Context Prompt
          </Button>
        </Tooltip>
        <Tooltip title="Paste copied prompt into terminal input">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab || !lastContextPrompt}
            icon={<SendOutlined rev={undefined} />}
            onClick={() => void pasteContextPrompt()}
          >
            Paste Prompt
          </Button>
        </Tooltip>
        <Tooltip title="Selection to IM Input">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab}
            icon={<CopyOutlined rev={undefined} />}
            onClick={selectionToIM}
          >
            Selection -&gt; IM
          </Button>
        </Tooltip>
        <Tooltip title="Capture current terminal output to IM input">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab}
            icon={<CopyOutlined rev={undefined} />}
            onClick={() => captureTerminalOutput("manual")}
          >
            Capture Output
          </Button>
        </Tooltip>
        <div className="terminal-dock-toggle">
          <span>Auto Receive</span>
          <Switch
            size="small"
            checked={autoReceiveEnabled}
            disabled={!activeTab}
            onChange={setAutoReceiveEnabled}
          />
        </div>
        <div className="terminal-dock-toggle">
          <span>Auto Send</span>
          <Switch
            size="small"
            checked={autoSendEnabled}
            disabled={!activeTab || !autoReceiveEnabled}
            onChange={setAutoSendEnabled}
          />
        </div>
        <Tooltip title="Clear Terminal">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab}
            icon={<DeleteOutlined rev={undefined} />}
            onClick={() => activeTab && clearTabOutput(activeTab.id)}
          >
            Clear
          </Button>
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
                output={activeTabOutput}
                onReady={(tabID, api) => {
                  if (!api) {
                    terminalApisRef.current.delete(tabID);
                    recentTerminalSelectionsRef.current.delete(tabID);
                    return;
                  }
                  terminalApisRef.current.set(tabID, api);
                }}
                onSelectionChange={(tabID, selection) => {
                  if (!selection.trim()) return;
                  recentTerminalSelectionsRef.current.set(tabID, {
                    text: selection,
                    updatedAt: Date.now(),
                  });
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

      <Modal
        title="Command Templates"
        open={commandModalOpen}
        onCancel={() => setCommandModalOpen(false)}
        footer={[
          <Button key="add" onClick={addCommandTemplate}>
            Add Template
          </Button>,
          <Button key="reset" onClick={resetCommandTemplates}>
            Reset
          </Button>,
          <Button key="close" type="primary" onClick={() => setCommandModalOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <div className="terminal-dock-template-list">
          {commandTemplates.map((template) => (
            <div key={template.id} className="terminal-dock-template-item">
              <div className="terminal-dock-template-row">
                <Checkbox
                  checked={template.enabled}
                  onChange={(event) =>
                    updateCommandTemplate(template.id, {
                      enabled: event.target.checked,
                    })
                  }
                >
                  Enabled
                </Checkbox>
                <Button
                  size="small"
                  danger
                  disabled={template.id === "opencode"}
                  icon={<DeleteOutlined rev={undefined} />}
                  onClick={() => removeCommandTemplate(template.id)}
                />
              </div>
              <Input
                size="small"
                placeholder="Menu title"
                value={template.title}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    title: event.target.value,
                  })
                }
              />
              <Input
                size="small"
                placeholder="Command to inject"
                value={template.command}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    command: event.target.value,
                  })
                }
              />
              <Input
                size="small"
                placeholder="Description"
                value={template.description}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    description: event.target.value,
                  })
                }
              />
            </div>
          ))}
        </div>
      </Modal>
    </aside>
  );
};

export default TerminalDock;
