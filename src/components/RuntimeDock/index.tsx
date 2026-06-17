import {
  ApiOutlined,
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { t } from "i18next";
import { useParams } from "react-router-dom";

import { useConversationStore, useRuntimeDockStore } from "@/store";

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
  const addPlaceholderRuntime = useRuntimeDockStore(
    (state) => state.addPlaceholderRuntime,
  );
  const removeAttachment = useRuntimeDockStore((state) => state.removeAttachment);

  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const attachments = conversationID
    ? attachmentsByConversation[conversationID] ?? []
    : [];

  if (!panelOpen) return null;

  const onAddRuntime = () => {
    if (!conversationID) return;
    addPlaceholderRuntime(conversationID);
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
          disabled={!conversationID}
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
              description={t("runtimeDock.noRuntime")}
            />
            <Button
              type="primary"
              icon={<PlusOutlined rev={undefined} />}
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
                  <Tag color="default">{attachment.status}</Tag>
                  <span className="text-xs text-[var(--sub-text)]">
                    {dayjs(attachment.createdAt).format("YYYY-MM-DD HH:mm")}
                  </span>
                </div>
                <div className="rounded bg-white px-3 py-2 text-xs text-[var(--sub-text)] dark:bg-[#1f1f1f]">
                  {t("runtimeDock.phaseTwoHint")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default RuntimeDock;
