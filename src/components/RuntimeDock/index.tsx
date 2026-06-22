import {
  ApiOutlined,
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  ExportOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  type MessageItem as OIMMessageItem,
  MessageType,
  ViewType,
} from "@openim/wasm-client-sdk";
import { Button, Empty, Input, message, Modal, Tabs, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { t } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore, useRuntimeDockStore } from "@/store";
import { RuntimeAttachment } from "@/store/runtimeDock";
import { emit } from "@/utils/events";

import RuntimeTerminalSurface, { TerminalSurfaceApi } from "./TerminalSurface";

const statusColor: Record<RuntimeAttachment["status"], string> = {
  detached: "default",
  starting: "processing",
  running: "success",
  error: "error",
  stopped: "warning",
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
  return `- ${timestamp} **${sender}**: [type=${msg.contentType}]`;
};

const RuntimeDock = () => {
  const { conversationID: routeConversationID } = useParams();
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const panelOpen = useRuntimeDockStore((state) => state.panelOpen);
  const setPanelOpen = useRuntimeDockStore((state) => state.setPanelOpen);
  const attachmentsByConversation = useRuntimeDockStore(
    (state) => state.attachmentsByConversation,
  );
  const addRuntime = useRuntimeDockStore((state) => state.addRuntime);
  const startRuntime = useRuntimeDockStore((state) => state.startRuntime);
  const interruptRuntime = useRuntimeDockStore((state) => state.interruptRuntime);
  const stopRuntime = useRuntimeDockStore((state) => state.stopRuntime);
  const clearTranscript = useRuntimeDockStore((state) => state.clearTranscript);
  const handleRuntimeEvent = useRuntimeDockStore((state) => state.handleRuntimeEvent);
  const removeAttachment = useRuntimeDockStore((state) => state.removeAttachment);

  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const attachments = conversationID
    ? attachmentsByConversation[conversationID] ?? []
    : [];
  const terminalAvailable = Boolean(window.electronAPI);
  const terminalApisRef = useRef<Map<string, TerminalSurfaceApi>>(new Map());
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createCommand, setCreateCommand] = useState("");
  const [lastExportRelativePath, setLastExportRelativePath] = useState<string | null>(
    null,
  );

  const activeAttachment = useMemo(
    () => attachments.find((item) => item.id === activeKey) ?? attachments[0],
    [attachments, activeKey],
  );

  useEffect(() => {
    if (!activeKey && attachments.length > 0) {
      setActiveKey(attachments[0].id);
    }
  }, [activeKey, attachments]);

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("runtime:event", handleRuntimeEvent);
  }, [handleRuntimeEvent]);

  if (!panelOpen) return null;

  const ensureConversationWorkspace = async () => {
    if (!conversationID || !window.electronAPI) return undefined;
    return window.electronAPI.ipcInvoke<string>(
      "workspace:getConversationDir",
      conversationID,
    );
  };

  const onCreateTerminal = async () => {
    if (!conversationID) return;
    const newID = addRuntime(
      conversationID,
      "terminal",
      createCommand.trim() || undefined,
    );
    setCreateModalOpen(false);
    setCreateCommand("");
    if (!newID) return;
    setActiveKey(newID);
    await startRuntime(conversationID, newID);
  };

  const onRunCommand = async () => {
    if (!conversationID || !activeAttachment) return;
    setCommandModalOpen(false);
    if (!commandText.trim()) return;
    await useRuntimeDockStore
      .getState()
      .writeInput(conversationID, activeAttachment.id, `${commandText.trim()}\r\n`);
    setCommandText("");
  };

  const exportRecentHistory = async () => {
    if (!conversationID || !window.electronAPI) return;
    const workspaceDir = await ensureConversationWorkspace();
    if (!workspaceDir) return;

    const { data } = await IMSDK.getAdvancedHistoryMessageList({
      count: 50,
      startClientMsgID: "",
      conversationID,
      viewType: ViewType.History,
    });
    const lines = [
      `# OpenIM history export`,
      ``,
      `- conversationID: \`${conversationID}\``,
      `- exportedAt: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`,
      `- workspace: \`${workspaceDir}\``,
      ``,
      `## Messages`,
      ``,
      ...data.messageList.map(formatMessageAsMarkdown),
      ``,
    ];
    const filename = `im-history-${dayjs().format("YYYYMMDD-HHmmss")}.md`;
    const relativePath = `history/${filename}`;
    await window.electronAPI.ipcInvoke("workspace:writeFile", {
      conversationID,
      relativePath,
      content: lines.join("\n"),
    });
    setLastExportRelativePath(relativePath);
    message.success(t("runtimeDock.exportSuccess"));
  };

  const copyContextPrompt = async () => {
    if (!conversationID) return;
    const workspaceDir = await ensureConversationWorkspace();
    if (!workspaceDir) return;
    const historyRef = lastExportRelativePath
      ? `./${lastExportRelativePath}`
      : "(run Export first)";
    const prompt = [
      `# Context`,
      ``,
      `You are running in this workspace directory:`,
      ``,
      `- Workspace: ${workspaceDir}`,
      ``,
      `Recent IM history is exported as:`,
      ``,
      `- ${historyRef}`,
      ``,
      `Notes: OpenIM is only providing a terminal + workspace + exported files. The CLI runtime should manage its own session, tools, permissions, memory, etc.`,
      ``,
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    message.success(t("runtimeDock.copied"));
  };

  const copySelectionToChatInput = async () => {
    if (!activeAttachment) return;
    const api = terminalApisRef.current.get(activeAttachment.id);
    const selection = api?.getSelectionText().trim();
    if (!selection) {
      message.info(t("runtimeDock.noSelection"));
      return;
    }
    await navigator.clipboard.writeText(selection);
    emit("APPEND_CHAT_INPUT", selection);
    message.success(t("runtimeDock.selectionAdded"));
  };

  return (
    <aside className="flex h-full min-w-[280px] flex-col border-l border-[var(--gap-text)] bg-white dark:bg-[#1f1f1f]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--gap-text)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ApiOutlined className="text-base text-[var(--primary)]" rev={undefined} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{t("runtimeDock.title")}</div>
            <div className="truncate text-[11px] text-[var(--sub-text)]">
              {conversationID ?? t("runtimeDock.noConversation")}
            </div>
          </div>
        </div>
        <Tooltip title={t("runtimeDock.close")}>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined rev={undefined} />}
            onClick={() => setPanelOpen(false)}
          />
        </Tooltip>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gap-text)] px-4 py-3">
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined rev={undefined} />}
          disabled={!conversationID || !terminalAvailable}
          onClick={() => setCreateModalOpen(true)}
        >
          {t("runtimeDock.newTerminal")}
        </Button>
        <Button
          size="small"
          icon={<ExportOutlined rev={undefined} />}
          disabled={!conversationID || !terminalAvailable}
          onClick={() => void exportRecentHistory()}
        >
          {t("runtimeDock.exportHistory")}
        </Button>
        <Button
          size="small"
          icon={<CopyOutlined rev={undefined} />}
          disabled={!conversationID || !terminalAvailable}
          onClick={() => void copyContextPrompt()}
        >
          {t("runtimeDock.copyContext")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!conversationID ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("runtimeDock.noConversation")}
          />
        ) : !terminalAvailable ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("runtimeDock.electronRequired")}
          />
        ) : attachments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("runtimeDock.noRuntime")}
            />
            <Button
              type="primary"
              icon={<PlusOutlined rev={undefined} />}
              disabled={!terminalAvailable}
              onClick={() => setCreateModalOpen(true)}
            >
              {t("runtimeDock.newTerminal")}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {activeAttachment && (
                <>
                  <Tag color={statusColor[activeAttachment.status]}>
                    {activeAttachment.status}
                  </Tag>
                  <span className="text-xs text-[var(--sub-text)]">
                    {dayjs(activeAttachment.createdAt).format("YYYY-MM-DD HH:mm")}
                  </span>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined rev={undefined} />}
                    disabled={
                      activeAttachment.status === "running" ||
                      activeAttachment.status === "starting"
                    }
                    onClick={() => startRuntime(conversationID, activeAttachment.id)}
                  >
                    {t("runtimeDock.start")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined rev={undefined} />}
                    disabled={activeAttachment.status === "starting"}
                    onClick={() => startRuntime(conversationID, activeAttachment.id)}
                  >
                    {t("runtimeDock.restart")}
                  </Button>
                  <Button
                    size="small"
                    icon={<PauseCircleOutlined rev={undefined} />}
                    disabled={activeAttachment.status !== "running"}
                    onClick={() =>
                      interruptRuntime(conversationID, activeAttachment.id)
                    }
                  >
                    {t("runtimeDock.interrupt")}
                  </Button>
                  <Button
                    size="small"
                    icon={<StopOutlined rev={undefined} />}
                    disabled={activeAttachment.status !== "running"}
                    onClick={() => stopRuntime(conversationID, activeAttachment.id)}
                  >
                    {t("runtimeDock.stop")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ClearOutlined rev={undefined} />}
                    onClick={() => clearTranscript(conversationID, activeAttachment.id)}
                  >
                    {t("runtimeDock.clearTranscript")}
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined rev={undefined} />}
                    onClick={() => void copySelectionToChatInput()}
                  >
                    {t("runtimeDock.copySelection")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ExportOutlined rev={undefined} />}
                    onClick={() => setCommandModalOpen(true)}
                  >
                    {t("runtimeDock.runCommand")}
                  </Button>
                </>
              )}
            </div>
            <Tabs
              activeKey={activeKey}
              onChange={(key) => setActiveKey(key)}
              type="editable-card"
              hideAdd
              onEdit={(targetKey, action) => {
                if (action !== "remove") return;
                const id = String(targetKey);
                removeAttachment(conversationID, id);
                terminalApisRef.current.delete(id);
                if (activeKey === id) setActiveKey(undefined);
              }}
              items={attachments.map((attachment, index) => ({
                key: attachment.id,
                label: `${t("runtimeDock.terminalTab")} ${index + 1}`,
                children: (
                  <RuntimeTerminalSurface
                    attachment={attachment}
                    onReady={(attachmentID, api) => {
                      if (!api) {
                        terminalApisRef.current.delete(attachmentID);
                        return;
                      }
                      terminalApisRef.current.set(attachmentID, api);
                    }}
                  />
                ),
              }))}
            />
          </>
        )}
      </div>

      <Modal
        title={t("runtimeDock.newTerminal")}
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => void onCreateTerminal()}
        okButtonProps={{ disabled: !conversationID }}
      >
        <div className="text-xs text-[var(--sub-text)]">
          {t("runtimeDock.newTerminalHint")}
        </div>
        <Input
          className="mt-2"
          placeholder={t("runtimeDock.initialCommandPlaceholder")}
          value={createCommand}
          onChange={(e) => setCreateCommand(e.target.value)}
          onPressEnter={() => void onCreateTerminal()}
        />
      </Modal>

      <Modal
        title={t("runtimeDock.runCommand")}
        open={commandModalOpen}
        onCancel={() => setCommandModalOpen(false)}
        onOk={() => void onRunCommand()}
        okButtonProps={{ disabled: !activeAttachment || !commandText.trim() }}
      >
        <Input.TextArea
          rows={4}
          placeholder={t("runtimeDock.runCommandPlaceholder")}
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
        />
      </Modal>
    </aside>
  );
};

export default RuntimeDock;
