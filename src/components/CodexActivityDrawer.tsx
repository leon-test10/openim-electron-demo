import { MoreOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  forwardRef,
  ForwardRefRenderFunction,
  useEffect,
  useMemo,
  useState,
} from "react";

import CodexRuntimeTrace from "@/components/CodexRuntimeTrace";
import { useCodexConversation } from "@/hooks/useCodexConversation";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { CodexRuntimeEvent, CodexRuntimeJob, CodexSessionRecord } from "@/types/codex";
import { feedbackToast } from "@/utils/common";
import { getViteEnv } from "@/utils/env";

const defaultProjectPath = getViteEnv(
  "VITE_CODEX_DEFAULT_PROJECT_PATH",
  "D:\\agent_trial\\claude_code\\official-openim",
);

const jobColors: Record<CodexRuntimeJob["status"], string> = {
  queued: "processing",
  running: "processing",
  cancelling: "warning",
  succeeded: "success",
  failed: "error",
  cancelled: "default",
};

const CodexActivityDrawer: ForwardRefRenderFunction<OverlayVisibleHandle, unknown> = (
  _,
  ref,
) => {
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);
  const {
    isCodexConversation,
    status,
    error,
    activeJob,
    latestJob,
    queuedJobCount,
    sessions,
    eventsByJobId,
    cancel,
    retry,
    rebind,
    createSession,
    activateSession,
    renameSession,
    archiveSession,
    loadJobEvents,
  } = useCodexConversation();
  const [selectedJobID, setSelectedJobID] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState(defaultProjectPath);
  const [submitting, setSubmitting] = useState(false);

  const jobs = useMemo(() => {
    const byId = new Map<string, CodexRuntimeJob>();
    for (const job of [activeJob, latestJob, ...(status?.recentJobs ?? [])]) {
      if (job) {
        byId.set(job.id, job);
      }
    }
    return Array.from(byId.values());
  }, [activeJob, latestJob, status?.recentJobs]);

  const selectedJob =
    jobs.find((job) => job.id === selectedJobID) ?? activeJob ?? latestJob ?? null;
  const selectedEvents: CodexRuntimeEvent[] = selectedJob
    ? eventsByJobId[selectedJob.id] ?? []
    : [];
  const hasActiveJob = Boolean(activeJob);

  useEffect(() => {
    if (!selectedJobID && (activeJob?.id || latestJob?.id)) {
      setSelectedJobID(activeJob?.id ?? latestJob?.id ?? null);
    }
  }, [activeJob?.id, latestJob?.id, selectedJobID]);

  useEffect(() => {
    if (status?.activeSession?.codexProjectPath) {
      setProjectPath(status.activeSession.codexProjectPath);
    }
  }, [status?.activeSession?.codexProjectPath]);

  useEffect(() => {
    if (isOverlayOpen && selectedJob?.id) {
      void loadJobEvents(selectedJob.id);
    }
  }, [isOverlayOpen, loadJobEvents, selectedJob?.id]);

  if (!isCodexConversation) {
    return null;
  }

  const runAction = async (action: () => Promise<unknown>, successMessage?: string) => {
    setSubmitting(true);
    try {
      await action();
      if (successMessage) {
        feedbackToast({ msg: successMessage });
      }
      return true;
    } catch (error) {
      feedbackToast({ error });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title="Codex Activity"
      placement="right"
      rootClassName="chat-drawer"
      destroyOnClose={false}
      onClose={closeOverlay}
      open={isOverlayOpen}
      maskClassName="opacity-0"
      maskMotion={{ visible: false }}
      width={560}
      getContainer={"#chat-container"}
    >
      <Tabs
        className="px-3"
        items={[
          {
            key: "runs",
            label: "Runs",
            children: (
              <RunsTab
                jobs={jobs}
                activeJob={activeJob}
                selectedJob={selectedJob}
                selectedEvents={selectedEvents}
                queuedJobCount={queuedJobCount}
                error={error}
                submitting={submitting}
                onSelectJob={setSelectedJobID}
                onCancel={() => runAction(cancel, "Codex job cancellation requested")}
                onRetry={(jobID) => runAction(() => retry(jobID), "Codex job queued")}
              />
            ),
          },
          {
            key: "sessions",
            label: "Sessions",
            children: (
              <SessionsTab
                sessions={sessions}
                hasActiveJob={hasActiveJob}
                error={error}
                submitting={submitting}
                projectPath={projectPath}
                onCreate={() =>
                  runAction(
                    () => createSession({ codexProjectPath: projectPath }),
                    "New Codex session activated",
                  )
                }
                onActivate={(session) =>
                  runAction(
                    () => activateSession(session.id),
                    "Codex session activated",
                  )
                }
                onRename={(session, displayName) =>
                  runAction(
                    () => renameSession(session.id, displayName),
                    "Codex session renamed",
                  )
                }
                onArchive={(session) =>
                  runAction(() => archiveSession(session.id), "Codex session archived")
                }
              />
            ),
          },
          {
            key: "config",
            label: "Config",
            children: (
              <ConfigTab
                activeSession={status?.activeSession ?? null}
                latestJob={latestJob}
                projectPath={projectPath}
                hasActiveJob={hasActiveJob}
                submitting={submitting}
                onProjectPathChange={setProjectPath}
                onRebind={() =>
                  runAction(
                    () => rebind({ codexProjectPath: projectPath }),
                    "Codex binding changed",
                  )
                }
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
};

function RunsTab({
  jobs,
  activeJob,
  selectedJob,
  selectedEvents,
  queuedJobCount,
  error,
  submitting,
  onSelectJob,
  onCancel,
  onRetry,
}: {
  jobs: CodexRuntimeJob[];
  activeJob: CodexRuntimeJob | null | undefined;
  selectedJob: CodexRuntimeJob | null;
  selectedEvents: CodexRuntimeEvent[];
  queuedJobCount: number;
  error: string | null;
  submitting: boolean;
  onSelectJob: (jobID: string) => void;
  onCancel: () => Promise<unknown>;
  onRetry: (jobID: string) => Promise<unknown>;
}) {
  return (
    <div className="space-y-3">
      <Card size="small">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">
              {selectedJob ? "Selected run" : "No runs"}
            </div>
            <div className="mt-1 text-xs text-[var(--sub-text)]">
              {queuedJobCount > 0 ? `${queuedJobCount} queued` : "No queued jobs"}
              {selectedJob ? ` / ${formatJobTiming(selectedJob)}` : ""}
            </div>
          </div>
          <Space>
            <Button
              size="small"
              danger
              disabled={!activeJob?.canCancel}
              loading={submitting}
              onClick={() => void onCancel()}
            >
              Cancel
            </Button>
            <Button
              size="small"
              disabled={!selectedJob?.canRetry}
              loading={submitting}
              onClick={() => selectedJob && void onRetry(selectedJob.id)}
            >
              Retry
            </Button>
          </Space>
        </div>
        {error ? (
          <div className="mt-2 text-xs text-red-500">Bridge: {error}</div>
        ) : null}
      </Card>

      <List
        size="small"
        dataSource={jobs}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Codex runs" />
          ),
        }}
        renderItem={(job) => (
          <List.Item
            className={job.id === selectedJob?.id ? "!bg-[#F5F9FF]" : undefined}
            onClick={() => onSelectJob(job.id)}
          >
            <div className="w-full cursor-pointer">
              <div className="flex items-center justify-between gap-3">
                <Typography.Text className="max-w-[320px]" ellipsis>
                  {job.inputText}
                </Typography.Text>
                <Tag color={jobColors[job.status]}>{job.status}</Tag>
              </div>
              <div className="mt-1 text-xs text-[var(--sub-text)]">
                {formatJobTiming(job)}
              </div>
            </div>
          </List.Item>
        )}
      />

      <Card size="small" title="Runtime trace">
        <CodexRuntimeTrace events={selectedEvents} />
      </Card>
    </div>
  );
}

function SessionsTab({
  sessions,
  hasActiveJob,
  error,
  submitting,
  projectPath,
  onCreate,
  onActivate,
  onArchive,
  onRename,
}: {
  sessions: CodexSessionRecord[];
  hasActiveJob: boolean;
  error: string | null;
  submitting: boolean;
  projectPath: string;
  onCreate: () => Promise<boolean>;
  onActivate: (session: CodexSessionRecord) => Promise<boolean>;
  onArchive: (session: CodexSessionRecord) => Promise<boolean>;
  onRename: (session: CodexSessionRecord, displayName: string) => Promise<boolean>;
}) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openRename = (session: CodexSessionRecord) => {
    setEditingSessionId(session.id);
    setRenameValue(getSessionTitle(session));
  };
  const closeRename = () => {
    setEditingSessionId(null);
    setRenameValue("");
  };
  const saveRename = async (session: CodexSessionRecord) => {
    if (!renameValue.trim()) return;
    const ok = await onRename(session, renameValue.trim());
    if (ok) {
      closeRename();
    }
  };

  return (
    <div className="space-y-3 px-3 pb-4">
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--sub-text)]">
          Select a session to use it for the next Codex run.
        </div>
        <Button
          disabled={hasActiveJob || !projectPath.trim()}
          loading={submitting}
          onClick={() => void onCreate()}
        >
          New Session
        </Button>
      </div>

      <List
        size="small"
        dataSource={sessions}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No session records"
            />
          ),
        }}
        renderItem={(session) => {
          const canActivate =
            !hasActiveJob && !session.isActive && session.status !== "archived";
          const canArchive = !hasActiveJob && session.status !== "archived";
          return (
            <List.Item
              className={[
                "mb-2 cursor-pointer rounded border px-3 py-3 transition",
                session.isActive
                  ? "!border-[#95de64] !bg-[#f6ffed]"
                  : "!border-[#f0f0f0]",
                canActivate ? "hover:!border-[#91caff] hover:!bg-[#f5f9ff]" : "",
                session.status === "archived" ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
              onClick={() => {
                if (canActivate && !submitting && editingSessionId !== session.id) {
                  void onActivate(session);
                }
              }}
              actions={[
                <Button
                  key="activate"
                  size="small"
                  type={session.isActive ? "primary" : "default"}
                  disabled={!canActivate || submitting}
                  loading={submitting && canActivate}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canActivate) {
                      void onActivate(session);
                    }
                  }}
                >
                  {session.isActive ? "Active" : "Activate"}
                </Button>,
                <Dropdown
                  key="more"
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "rename", label: "Rename" },
                      {
                        key: "archive",
                        label: "Archive",
                        disabled: !canArchive,
                      },
                    ],
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (key === "rename") {
                        openRename(session);
                      }
                      if (key === "archive") {
                        void onArchive(session);
                      }
                    },
                  }}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<MoreOutlined rev={undefined} />}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Dropdown>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{getSessionTitle(session)}</span>
                    {session.isActive ? <Tag color="success">Active</Tag> : null}
                    {!session.isActive && session.status === "archived" ? (
                      <Tag>Archived</Tag>
                    ) : null}
                    {!session.isActive && session.status !== "archived" ? (
                      <Tag color="blue">Ready</Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <div className="space-y-1 text-xs">
                    <div>{session.lastSummary ?? "No summary yet"}</div>
                    <div>Project: {session.codexProjectPath}</div>
                    <div>Name source: {session.displayNameSource ?? "default"}</div>
                    <div>
                      Updated: {new Date(session.updatedAt).toLocaleString()} / Record:{" "}
                      {session.id}
                    </div>
                    {editingSessionId === session.id ? (
                      <div
                        className="flex items-center gap-2 pt-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Input
                          aria-label="Session name"
                          size="small"
                          value={renameValue}
                          maxLength={80}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onPressEnter={() => void saveRename(session)}
                        />
                        <Button
                          size="small"
                          type="primary"
                          loading={submitting}
                          disabled={!renameValue.trim()}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void saveRename(session);
                          }}
                          onClick={() => void saveRename(session)}
                        >
                          Save
                        </Button>
                        <Button size="small" onClick={closeRename}>
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}

function ConfigTab({
  activeSession,
  latestJob,
  projectPath,
  hasActiveJob,
  submitting,
  onProjectPathChange,
  onRebind,
}: {
  activeSession: CodexSessionRecord | null;
  latestJob: CodexRuntimeJob | null | undefined;
  projectPath: string;
  hasActiveJob: boolean;
  submitting: boolean;
  onProjectPathChange: (value: string) => void;
  onRebind: () => Promise<unknown>;
}) {
  return (
    <div className="space-y-3">
      <Card size="small" title="Project path">
        <Input
          value={projectPath}
          disabled={hasActiveJob}
          onChange={(event) => onProjectPathChange(event.target.value)}
        />
        <div className="mt-2 text-xs text-[var(--sub-text)]">
          Codex CLI runs with this directory as <code>--cd</code>. This is runtime
          configuration, not an OpenIM setting.
        </div>
        <Button
          className="mt-3"
          size="small"
          disabled={hasActiveJob || !projectPath.trim()}
          loading={submitting}
          onClick={() => void onRebind()}
        >
          Change project and start new binding
        </Button>
      </Card>

      <Card size="small" title="Runtime">
        <InfoRow
          label="Codex session"
          value={activeSession?.codexSessionId ?? "not created"}
        />
        <InfoRow label="Codex home" value={activeSession?.codexHomeDir ?? "default"} />
        <InfoRow
          label="Seed mode"
          value={activeSession?.codexHomeSeedMode ?? "default"}
        />
        <InfoRow
          label="Sandbox"
          value={activeSession?.sandboxMode ?? "Codex CLI default"}
        />
        <InfoRow
          label="Latest job"
          value={
            latestJob ? `${latestJob.status} / ${formatJobTiming(latestJob)}` : "none"
          }
        />
      </Card>
    </div>
  );
}

function getSessionTitle(session: CodexSessionRecord): string {
  return (
    session.displayName ||
    session.codexSessionId ||
    (session.isActive ? "Active session" : "New session")
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 text-xs">
      <div className="text-[var(--sub-text)]">{label}</div>
      <Typography.Text className="text-xs" copyable ellipsis>
        {value}
      </Typography.Text>
    </div>
  );
}

function formatJobTiming(job: CodexRuntimeJob): string {
  const queued = job.queuedMs ?? (job.startedAt ? job.startedAt - job.createdAt : null);
  const running = job.runningMs ?? job.totalDurationMs ?? null;
  const total = job.totalMs ?? (job.finishedAt ? job.finishedAt - job.createdAt : null);
  const parts = [
    queued === null ? null : `queued ${formatMs(queued)}`,
    running === null ? null : `running ${formatMs(running)}`,
    total === null ? null : `total ${formatMs(total)}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" / ") || "timing unavailable";
}

function formatMs(value: number): string {
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${Math.round(value / 1000)}s`;
}

export default forwardRef(CodexActivityDrawer);
