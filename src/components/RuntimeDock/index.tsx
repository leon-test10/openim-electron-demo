import {
  ApiOutlined,
  CloseOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { t } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { useConversationStore, useRuntimeDockStore } from "@/store";
import { RuntimeAttachment } from "@/store/runtimeDock";

const { TextArea } = Input;

const statusColor: Record<RuntimeAttachment["status"], string> = {
  detached: "default",
  starting: "processing",
  running: "success",
  error: "error",
  stopped: "warning",
};

const RuntimeInputBox = ({
  attachment,
  conversationID,
}: {
  attachment: RuntimeAttachment;
  conversationID: string;
}) => {
  const [input, setInput] = useState("echo READY");
  const [submitting, setSubmitting] = useState(false);
  const writeInput = useRuntimeDockStore((state) => state.writeInput);
  const disabled = attachment.status !== "running" || submitting;

  const onSend = async () => {
    if (!input.trim()) return;
    setSubmitting(true);
    await writeInput(conversationID, attachment.id, `${input}\r\n`);
    setSubmitting(false);
  };

  return (
    <div className="mt-3 space-y-2">
      <TextArea
        value={input}
        rows={2}
        disabled={attachment.status !== "running"}
        onChange={(event) => setInput(event.target.value)}
        onPressEnter={(event) => {
          if (!event.shiftKey) {
            event.preventDefault();
            void onSend();
          }
        }}
      />
      <Button
        block
        size="small"
        type="primary"
        icon={<SendOutlined rev={undefined} />}
        disabled={disabled}
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
  const stopRuntime = useRuntimeDockStore((state) => state.stopRuntime);
  const handleRuntimeEvent = useRuntimeDockStore((state) => state.handleRuntimeEvent);
  const removeAttachment = useRuntimeDockStore((state) => state.removeAttachment);

  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const attachments = conversationID
    ? attachmentsByConversation[conversationID] ?? []
    : [];
  const terminalAvailable = Boolean(window.electronAPI);
  const defaultProfileID = useMemo(
    () => (terminalAvailable ? "powershell-terminal" : undefined),
    [terminalAvailable],
  );

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("runtime:event", handleRuntimeEvent);
  }, [handleRuntimeEvent]);

  if (!panelOpen) return null;

  const onAddRuntime = () => {
    if (!conversationID) return;
    addRuntime(conversationID, defaultProfileID);
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
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined rev={undefined} />}
          disabled={!conversationID || !terminalAvailable}
          onClick={onAddRuntime}
        >
          {t("runtimeDock.addRuntime")}
        </Button>
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
              onClick={onAddRuntime}
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
                    icon={<StopOutlined rev={undefined} />}
                    disabled={!terminalAvailable || attachment.status !== "running"}
                    onClick={() => stopRuntime(conversationID, attachment.id)}
                  >
                    {t("runtimeDock.stop")}
                  </Button>
                </div>
                {attachment.lastError && (
                  <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40">
                    {attachment.lastError}
                  </div>
                )}
                <div className="max-h-64 space-y-2 overflow-y-auto rounded bg-[#0f172a] px-3 py-2 font-mono text-xs text-slate-100">
                  {attachment.transcript.map((item) => (
                    <div key={item.id}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>{item.role}</span>
                        <span>{dayjs(item.createdAt).format("HH:mm:ss")}</span>
                      </div>
                      <div
                        className={
                          item.role === "stderr"
                            ? "whitespace-pre-wrap break-words text-red-300"
                            : item.role === "input"
                            ? "whitespace-pre-wrap break-words text-sky-300"
                            : "whitespace-pre-wrap break-words"
                        }
                      >
                        {item.content}
                      </div>
                    </div>
                  ))}
                </div>
                <RuntimeInputBox
                  attachment={attachment}
                  conversationID={conversationID}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default RuntimeDock;
