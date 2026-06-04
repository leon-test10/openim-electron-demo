import { Button, Divider, Input, Select, Space, Tag } from "antd";
import { useEffect, useState } from "react";

import CodexRuntimeTrace from "@/components/CodexRuntimeTrace";
import { useCodexConversation } from "@/hooks/useCodexConversation";
import { getViteEnv } from "@/utils/env";

const defaultProjectPath = getViteEnv(
  "VITE_CODEX_DEFAULT_PROJECT_PATH",
  "D:\\agent_trial\\claude_code\\official-openim",
);

export default function CodexBindingPanel() {
  const {
    isCodexConversation,
    status,
    error,
    activeJob,
    latestJob,
    queuedJobCount,
    sessions,
    activeJobEvents,
    cancel,
    retry,
    rebind,
    archive,
    createSession,
    activateSession,
  } = useCodexConversation();
  const [projectPath, setProjectPath] = useState(defaultProjectPath);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status?.activeSession?.codexProjectPath) {
      setProjectPath(status.activeSession.codexProjectPath);
    }
  }, [status?.activeSession?.codexProjectPath]);

  if (!isCodexConversation) {
    return null;
  }

  const hasActiveJob = Boolean(activeJob);
  const latestFailure = latestJob?.failureReason ?? latestJob?.errorText;
  const activeSessionId = status?.activeSession?.id;

  const runAction = async (action: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await action();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Divider className="m-0 border-4 border-[#F4F5F7]" />
      <div className="px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Codex Session</div>
          <Tag className="m-0">{status?.state ?? "unknown"}</Tag>
        </div>

        <div className="mb-2 text-xs text-[var(--sub-text)]">Project path</div>
        <Input
          value={projectPath}
          disabled={hasActiveJob}
          onChange={(event) => setProjectPath(event.target.value)}
        />

        <div className="mt-3 space-y-1 text-xs text-[var(--sub-text)]">
          <div>Session: {status?.activeSession?.codexSessionId ?? "not created"}</div>
          <div>Latest job: {latestJob?.status ?? "none"}</div>
          <div>Queued jobs: {queuedJobCount}</div>
          {latestJob?.totalDurationMs ? (
            <div>Duration: {Math.round(latestJob.totalDurationMs / 1000)}s</div>
          ) : null}
          {latestFailure ? (
            <div className="text-red-500">Error: {latestFailure}</div>
          ) : null}
          {error ? <div className="text-red-500">Bridge: {error}</div> : null}
        </div>

        <div className="mb-2 mt-3 text-xs text-[var(--sub-text)]">Session records</div>
        <Select
          className="w-full"
          value={activeSessionId}
          disabled={hasActiveJob || !sessions.length}
          placeholder="No Codex session records"
          onChange={(sessionRecordID) =>
            void runAction(() => activateSession(sessionRecordID))
          }
          options={sessions.map((session) => ({
            value: session.id,
            label: `${session.isActive ? "Active" : "Session"} - ${
              session.codexSessionId ?? "new"
            }`,
          }))}
        />

        <Space className="mt-3 flex-wrap">
          <Button
            size="small"
            disabled={hasActiveJob || !projectPath.trim()}
            loading={submitting}
            onClick={() =>
              void runAction(() => createSession({ codexProjectPath: projectPath }))
            }
          >
            New Session
          </Button>
          <Button
            size="small"
            disabled={hasActiveJob || !projectPath.trim()}
            loading={submitting}
            onClick={() =>
              void runAction(() => rebind({ codexProjectPath: projectPath }))
            }
          >
            Rebind
          </Button>
          <Button
            size="small"
            disabled={hasActiveJob}
            loading={submitting}
            onClick={() => void runAction(archive)}
          >
            Archive
          </Button>
          <Button
            size="small"
            danger
            disabled={!activeJob?.canCancel}
            loading={submitting}
            onClick={() => void runAction(cancel)}
          >
            Cancel
          </Button>
          <Button
            size="small"
            disabled={!latestJob?.canRetry}
            loading={submitting}
            onClick={() => void runAction(retry)}
          >
            Retry
          </Button>
        </Space>

        <Divider className="my-3" />
        <div className="text-xs font-medium">Runtime Trace</div>
        <CodexRuntimeTrace events={activeJobEvents} />
      </div>
    </>
  );
}
