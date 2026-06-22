import {
  ApiOutlined,
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Empty, type MenuProps, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { t } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useConversationStore, useRuntimeDockStore } from "@/store";
import { RuntimeAttachment } from "@/store/runtimeDock";

import RuntimeTerminalSurface from "./TerminalSurface";

const statusColor: Record<RuntimeAttachment["status"], string> = {
  detached: "default",
  starting: "processing",
  running: "success",
  error: "error",
  stopped: "warning",
};

const RuntimeTranscriptPanel = ({ attachment }: { attachment: RuntimeAttachment }) => {
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth",
    });
  }, [attachment.transcript]);

  return (
    <div
      ref={transcriptRef}
      className="max-h-64 select-text space-y-2 overflow-y-auto rounded border border-[#1e293b] bg-[#020817] px-3 py-3 font-mono text-xs leading-5 text-[#e2e8f0] shadow-inner"
    >
      {attachment.transcript.length === 0 ? (
        <div className="text-[11px] text-[#94a3b8]">
          {t("runtimeDock.transcriptEmpty")}
        </div>
      ) : (
        attachment.transcript.map((item) => (
          <div key={item.id}>
            <div className="mb-1 flex items-center justify-between text-[11px] text-[#94a3b8]">
              <span>{item.role}</span>
              <span>{dayjs(item.createdAt).format("HH:mm:ss")}</span>
            </div>
            <div
              className={
                item.role === "stderr"
                  ? "whitespace-pre-wrap break-words text-[#fca5a5]"
                  : item.role === "system"
                  ? "whitespace-pre-wrap break-words text-[#fde68a]"
                  : item.role === "input"
                  ? "whitespace-pre-wrap break-words text-[#7dd3fc]"
                  : "whitespace-pre-wrap break-words text-[#e2e8f0]"
              }
            >
              {item.content}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const RuntimeInputBox = ({
  attachment,
  conversationID,
}: {
  attachment: RuntimeAttachment;
  conversationID: string;
}) => {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");
  const writeInput = useRuntimeDockStore((state) => state.writeInput);
  const disabled = attachment.status !== "running" || submitting;
  const placeholder =
    attachment.runtimeProfileID === "opencode-terminal"
      ? t("runtimeDock.inputPlaceholderOpencode")
      : t("runtimeDock.inputPlaceholderPowerShell");
  const promptLabel =
    attachment.runtimeProfileID === "opencode-terminal" ? "opencode>" : "PS>";

  const onSend = async () => {
    const command = input.trim();
    if (!command) return;
    setSubmitting(true);
    try {
      await writeInput(conversationID, attachment.id, `${command}\r\n`);
      setHistory((previous) =>
        previous[previous.length - 1] === command ? previous : [...previous, command],
      );
      setHistoryIndex(-1);
      setDraftInput("");
      setInput("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 rounded border border-[#1e293b] bg-[#020817] px-3 py-2 font-mono text-sm text-[#e2e8f0]">
        <span className="shrink-0 text-[#7dd3fc]">{promptLabel}</span>
        <input
          value={input}
          disabled={attachment.status !== "running"}
          placeholder={placeholder}
          className="w-full border-0 bg-transparent text-sm text-[#e2e8f0] outline-none placeholder:text-[#64748b]"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onSend();
              return;
            }

            if (event.key === "ArrowUp") {
              if (!history.length) return;
              event.preventDefault();
              if (historyIndex === -1) {
                setDraftInput(input);
                setHistoryIndex(history.length - 1);
                setInput(history[history.length - 1]);
                return;
              }

              const nextIndex = Math.max(historyIndex - 1, 0);
              setHistoryIndex(nextIndex);
              setInput(history[nextIndex]);
              return;
            }

            if (event.key === "ArrowDown") {
              if (historyIndex === -1) return;
              event.preventDefault();
              if (historyIndex >= history.length - 1) {
                setHistoryIndex(-1);
                setInput(draftInput);
                return;
              }

              const nextIndex = historyIndex + 1;
              setHistoryIndex(nextIndex);
              setInput(history[nextIndex]);
            }
          }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--sub-text)]">
        <span>{t("runtimeDock.commandHint")}</span>
        <span>
          {history.length > 0
            ? t("runtimeDock.historyHint", { count: history.length })
            : t("runtimeDock.readyHint")}
        </span>
      </div>
      <Button
        block
        size="small"
        type="primary"
        icon={<SendOutlined rev={undefined} />}
        disabled={disabled || !input.trim()}
        loading={submitting}
        onClick={onSend}
      >
        {t("runtimeDock.sendInput")}
      </Button>
    </div>
  );
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
  const addRuntimeMenuItems = useMemo<MenuProps["items"]>(
    () => [
      {
        key: "powershell-terminal",
        label: t("runtimeDock.profilePowerShell"),
      },
      {
        key: "opencode-terminal",
        label: t("runtimeDock.profileOpencode"),
      },
    ],
    [],
  );

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("runtime:event", handleRuntimeEvent);
  }, [handleRuntimeEvent]);

  if (!panelOpen) return null;

  const onAddRuntimeMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (!conversationID) return;
    addRuntime(conversationID, key as RuntimeAttachment["runtimeProfileID"]);
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

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--gap-text)] px-4 py-3">
        <div>
          <div className="text-xs text-[var(--sub-text)]">
            {t("runtimeDock.attachments")}
          </div>
          <div className="text-lg font-semibold">{attachments.length}</div>
        </div>
        <Dropdown
          menu={{
            items: addRuntimeMenuItems,
            onClick: onAddRuntimeMenuClick,
          }}
          disabled={!conversationID || !terminalAvailable}
          trigger={["click"]}
        >
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined rev={undefined} />}
            disabled={!conversationID || !terminalAvailable}
          >
            {t("runtimeDock.addRuntime")} <DownOutlined rev={undefined} />
          </Button>
        </Dropdown>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!conversationID ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("runtimeDock.noConversation")}
          />
        ) : attachments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                terminalAvailable
                  ? t("runtimeDock.noRuntime")
                  : t("runtimeDock.electronRequired")
              }
            />
            <Button
              type="primary"
              icon={<PlusOutlined rev={undefined} />}
              disabled={!terminalAvailable}
              onClick={() => {
                if (!conversationID) return;
                addRuntime(conversationID, "powershell-terminal");
              }}
            >
              {t("runtimeDock.addRuntime")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="rounded-md border border-[var(--gap-text)] bg-[var(--gap-text)] p-3 dark:bg-[#262626]"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {attachment.title}
                    </div>
                    <div className="truncate text-xs text-[var(--sub-text)]">
                      {attachment.runtimeProfileID}
                    </div>
                  </div>
                  <Tooltip title={t("placeholder.remove")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined rev={undefined} />}
                      onClick={() => removeAttachment(conversationID, attachment.id)}
                    />
                  </Tooltip>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Tag color={statusColor[attachment.status]}>{attachment.status}</Tag>
                  <span className="text-xs text-[var(--sub-text)]">
                    {dayjs(attachment.createdAt).format("YYYY-MM-DD HH:mm")}
                  </span>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined rev={undefined} />}
                    disabled={
                      !terminalAvailable ||
                      attachment.status === "running" ||
                      attachment.status === "starting"
                    }
                    onClick={() => startRuntime(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.start")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined rev={undefined} />}
                    disabled={!terminalAvailable || attachment.status === "starting"}
                    onClick={() => startRuntime(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.restart")}
                  </Button>
                  <Button
                    size="small"
                    icon={<PauseCircleOutlined rev={undefined} />}
                    disabled={!terminalAvailable || attachment.status !== "running"}
                    onClick={() => interruptRuntime(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.interrupt")}
                  </Button>
                  <Button
                    size="small"
                    icon={<StopOutlined rev={undefined} />}
                    disabled={!terminalAvailable || attachment.status !== "running"}
                    onClick={() => stopRuntime(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.stop")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ClearOutlined rev={undefined} />}
                    onClick={() => clearTranscript(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.clearTranscript")}
                  </Button>
                </div>
                {attachment.lastError && (
                  <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40">
                    {attachment.lastError}
                  </div>
                )}
                {terminalAvailable ? (
                  <RuntimeTerminalSurface attachment={attachment} />
                ) : (
                  <>
                    <RuntimeTranscriptPanel attachment={attachment} />
                    <RuntimeInputBox
                      attachment={attachment}
                      conversationID={conversationID}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default RuntimeDock;
