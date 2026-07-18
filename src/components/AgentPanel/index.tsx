import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PushpinFilled,
  PushpinOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";

import { executeAgentBotRequest } from "@/services/agentSessions/botRouter";
import {
  loadRecentConversationMessages,
  persistAgentContextBundle,
} from "@/services/agentSessions/context";
import { useAgentSessionStore, useUserStore } from "@/store";
import type {
  CollaborationSession,
  GatewayAgentRecord,
} from "@/types/agentCollaboration";
import type {
  AgentInteraction,
  AgentMessage,
  AgentModelOption,
  AgentQuestionInteraction,
  AgentSession,
  BotRequest,
} from "@/types/agentSession";
import { emit } from "@/utils/events";

import { SafeMarkdown } from "./SafeMarkdown";

const statusColor: Record<AgentSession["status"], string> = {
  creating: "processing",
  idle: "success",
  running: "processing",
  waiting_permission: "warning",
  waiting_question: "warning",
  error: "error",
  disconnected: "default",
  recovery_required: "error",
  archived: "default",
};

const partText = (agentMessage: AgentMessage) =>
  agentMessage.parts
    .map((part) => part.text ?? part.path ?? "")
    .filter(Boolean)
    .join("\n");

const StreamedMarkdown = ({
  text,
  shouldStream,
}: {
  text: string;
  shouldStream: boolean;
}) => {
  const [displayed, setDisplayed] = useState(() => (shouldStream ? "" : text));
  const displayedRef = useRef(displayed);
  const targetRef = useRef(text);
  const streamingRef = useRef(shouldStream && Boolean(text));

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    targetRef.current = text;
    const canContinue = text.startsWith(displayedRef.current);
    if ((shouldStream || streamingRef.current) && canContinue) {
      streamingRef.current = displayedRef.current !== text;
      return;
    }
    streamingRef.current = false;
    setDisplayed(text);
  }, [shouldStream, text]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!streamingRef.current) return;
      setDisplayed((current) => {
        const target = targetRef.current;
        if (!target.startsWith(current)) {
          streamingRef.current = false;
          return target;
        }
        const remaining = target.length - current.length;
        if (remaining <= 0) {
          streamingRef.current = false;
          return target;
        }
        const step = Math.max(1, Math.ceil(remaining / 40));
        const next = target.slice(0, current.length + step);
        if (next === target) streamingRef.current = false;
        return next;
      });
    }, 24);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div data-testid="agent-streaming-text">
      <SafeMarkdown text={displayed} />
      {displayed !== text && (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--primary)] align-middle" />
      )}
    </div>
  );
};

const MessageCard = ({
  agentMessage,
  session,
}: {
  agentMessage: AgentMessage;
  session: AgentSession;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visible = agentMessage.parts.filter(
    (part) => part.type !== "reasoning" && part.type !== "tool",
  );
  const details = agentMessage.parts.filter(
    (part) => part.type === "reasoning" || part.type === "tool",
  );
  const text = partText(agentMessage);
  const replyText = visible
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  const attachFile = async (pathValue?: string) => {
    if (!pathValue) return;
    const absolute = /^[a-zA-Z]:[\\/]/.test(pathValue)
      ? pathValue
      : `${session.workspacePath.replace(/[\\/]+$/, "")}\\${pathValue}`;
    const stat = await window.electronAPI?.ipcInvoke<{
      exists: boolean;
      size: number;
    }>("file:statNativePath", absolute);
    if (!stat?.exists) {
      message.warning("Agent output file is no longer available");
      return;
    }
    emit("ADD_PENDING_CHAT_ATTACHMENT", {
      source: "workspace",
      fileName: pathValue.split(/[\\/]/).pop() ?? "agent-output",
      nativePath: absolute,
      relativePath: pathValue,
      fileType: "",
      fileSize: stat.size,
      sendKind: "file",
    });
    message.success("Added to IM attachments");
  };

  return (
    <div
      className={clsx(
        "group mb-3 max-w-[92%] rounded-xl border px-3 py-2",
        agentMessage.role === "user"
          ? "border-[var(--primary)]/20 ml-auto bg-[var(--primary-active)]"
          : "mr-auto border-black/5 bg-white dark:border-white/10 dark:bg-white/5",
      )}
      data-testid={`agent-message-${agentMessage.role}`}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-[var(--sub-text)]">
        <span>{agentMessage.role}</span>
        <div className="invisible flex items-center opacity-0 transition-opacity focus-within:visible focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
          <Tooltip title="Copy">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined rev={undefined} />}
              onClick={() => void navigator.clipboard.writeText(text)}
            />
          </Tooltip>
          <Tooltip title="Insert into IM composer">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined rev={undefined} />}
              onClick={() => emit("APPEND_CHAT_INPUT", text)}
              data-testid="agent-insert-to-im"
            />
          </Tooltip>
          {agentMessage.role === "assistant" && replyText && (
            <Tooltip title="Send to IM">
              <Button
                size="small"
                type="text"
                icon={<SendOutlined rev={undefined} />}
                onClick={() =>
                  Modal.confirm({
                    title: "Send this Agent reply to the current IM chat?",
                    content: (
                      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm">
                        {replyText}
                      </div>
                    ),
                    okText: "Send to IM",
                    onOk: () => emit("SEND_CHAT_INPUT", replyText),
                  })
                }
                data-testid="agent-send-to-im"
              />
            </Tooltip>
          )}
        </div>
      </div>
      {visible.map((part) =>
        part.type === "file" ? (
          <Button
            key={part.id}
            className="my-1 max-w-full"
            icon={<FolderOpenOutlined rev={undefined} />}
            onClick={() => void attachFile(part.path)}
          >
            <span className="truncate">{part.name ?? part.path ?? "Output file"}</span>
          </Button>
        ) : (
          <StreamedMarkdown
            key={part.id}
            text={part.text ?? ""}
            shouldStream={
              agentMessage.role === "assistant" &&
              !agentMessage.completedAt &&
              session.status === "running"
            }
          />
        ),
      )}
      {agentMessage.role === "assistant" &&
        !agentMessage.completedAt &&
        session.status === "running" && (
          <span
            className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[var(--primary)] align-middle"
            data-testid="agent-streaming-cursor"
          />
        )}
      {details.length > 0 && (
        <div className="mt-2 border-t border-black/5 pt-1 dark:border-white/10">
          <Button type="link" size="small" onClick={() => setDetailsOpen(!detailsOpen)}>
            {detailsOpen ? "Hide" : "Show"} reasoning / tools ({details.length})
          </Button>
          {detailsOpen &&
            details.map((part) => (
              <div
                key={part.id}
                className="my-1 rounded bg-black/5 p-2 text-xs dark:bg-white/5"
              >
                <div className="font-medium">{part.name ?? part.type}</div>
                <SafeMarkdown text={part.text ?? ""} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

const QuestionCard = ({
  interaction,
  onReply,
}: {
  interaction: AgentQuestionInteraction;
  onReply: (answers?: string[][], reject?: boolean) => void;
}) => {
  const [answers, setAnswers] = useState<string[][]>(
    interaction.questions.map(() => []),
  );
  return (
    <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 dark:bg-orange-950/20">
      {interaction.questions.map((question, questionIndex) => (
        <div key={questionIndex} className="mb-3 last:mb-0">
          <div className="mb-2 font-medium">{question.header ?? question.question}</div>
          {question.header && <div className="mb-2 text-sm">{question.question}</div>}
          <Checkbox.Group
            value={answers[questionIndex]}
            onChange={(values) =>
              setAnswers((current) =>
                current.map((value, index) =>
                  index === questionIndex ? values.map(String) : value,
                ),
              )
            }
          >
            <div className="flex flex-col gap-1">
              {question.options.map((option) => (
                <Checkbox key={option.label} value={option.label}>
                  {option.label}
                  {option.description && (
                    <span className="ml-1 text-xs text-[var(--sub-text)]">
                      {option.description}
                    </span>
                  )}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
          {question.custom && (
            <Input
              className="mt-2"
              placeholder="Custom answer"
              onChange={(event) =>
                setAnswers((current) =>
                  current.map((value, index) =>
                    index === questionIndex ? [event.target.value] : value,
                  ),
                )
              }
            />
          )}
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <Button type="primary" size="small" onClick={() => onReply(answers)}>
          Submit
        </Button>
        <Button danger size="small" onClick={() => onReply(undefined, true)}>
          Reject
        </Button>
      </div>
    </div>
  );
};

const InteractionCard = ({
  interaction,
  sessionID,
}: {
  interaction: AgentInteraction;
  sessionID: string;
}) => {
  const store = useAgentSessionStore.getState();
  if (interaction.type === "question") {
    return (
      <QuestionCard
        interaction={interaction}
        onReply={(answers, reject) =>
          void store.replyQuestion(sessionID, interaction.id, answers, reject)
        }
      />
    );
  }
  return (
    <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 dark:bg-orange-950/20">
      <div className="font-medium">Permission requested: {interaction.permission}</div>
      {interaction.patterns.length > 0 && (
        <div className="my-2 break-all text-xs">{interaction.patterns.join("\n")}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="small"
          type="primary"
          onClick={() => void store.replyPermission(sessionID, interaction.id, "once")}
        >
          Allow once
        </Button>
        <Button
          size="small"
          onClick={() =>
            void store.replyPermission(sessionID, interaction.id, "always")
          }
        >
          Always this session
        </Button>
        <Button
          danger
          size="small"
          onClick={() =>
            void store.replyPermission(sessionID, interaction.id, "reject")
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
};

const RuntimeStatusCard = ({ session }: { session: AgentSession }) => {
  if (
    session.status !== "error" &&
    session.status !== "recovery_required" &&
    session.status !== "disconnected"
  ) {
    return null;
  }

  return (
    <div
      className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:bg-red-950/20"
      data-testid="agent-runtime-error"
    >
      <div className="font-medium">Agent runtime is unavailable</div>
      <div className="my-2 break-words text-xs text-red-700 dark:text-red-300">
        {session.lastError ?? "The OpenCode session could not be restored."}
      </div>
      <Button
        danger
        size="small"
        onClick={() =>
          void useAgentSessionStore
            .getState()
            .recover(session.id)
            .then(() => message.success("Agent runtime session is ready"))
            .catch((error) =>
              message.error(error instanceof Error ? error.message : String(error)),
            )
        }
      >
        Retry in this workspace
      </Button>
    </div>
  );
};

const RuntimeRetryCard = ({ session }: { session: AgentSession }) => {
  if (session.status !== "running" || !session.lastError) return null;
  return (
    <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm dark:bg-orange-950/20">
      <div className="font-medium">Agent is retrying the model request</div>
      <div className="mt-1 break-words text-xs text-orange-700 dark:text-orange-300">
        {session.lastError}
      </div>
      <div className="mt-2 text-xs text-orange-700 dark:text-orange-300">
        Stop this retry, select a working model above, then send the request again.
      </div>
    </div>
  );
};

const BotRequestCard = ({ request }: { request: BotRequest }) => {
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      await executeAgentBotRequest(request);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };
  return (
    <div
      className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:bg-blue-950/20"
      data-testid="agent-pending-bot-request"
    >
      <div className="font-medium">Pending @bot request</div>
      <div className="mb-1 mt-0.5 text-xs text-[var(--sub-text)]">
        From {request.senderNickname ?? request.senderUserID}. It has not run yet.
      </div>
      <div className="mb-2 text-sm">
        {request.instructionText || "(no instruction)"}
      </div>
      <div className="mb-2 text-xs text-[var(--sub-text)]">
        Run it in this contact&apos;s pinned Bot session, or dismiss it.
      </div>
      <Button size="small" type="primary" loading={running} onClick={() => void run()}>
        Run in Bot session
      </Button>
      <Button
        size="small"
        className="ml-2"
        onClick={() =>
          void useAgentSessionStore.getState().ignoreBotRequest(request.id)
        }
      >
        Dismiss
      </Button>
    </div>
  );
};

const CollaborationCard = ({ session }: { session: AgentSession }) => {
  const self = useUserStore((state) => state.selfInfo);
  const [collaborations, setCollaborations] = useState<CollaborationSession[]>([]);
  const [agents, setAgents] = useState<GatewayAgentRecord[]>([]);
  const [objective, setObjective] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI) return;
    const [nextCollaborations, nextAgents] = await Promise.all([
      window.electronAPI.ipcInvoke<CollaborationSession[]>(
        "agent-collaboration:list",
        session.conversationID,
      ),
      window.electronAPI.ipcInvoke<GatewayAgentRecord[]>("agent-gateway:discover", {
        capability: "run.execute",
      }),
    ]);
    setCollaborations(
      nextCollaborations.filter((item) => item.sessionID === session.id),
    );
    setAgents(nextAgents);
  }, [session.conversationID, session.id]);

  useEffect(() => {
    void refresh();
    if (!window.electronAPI) return;
    return window.electronAPI.subscribe(
      "agent-collaboration:event",
      (value: { collaboration?: CollaborationSession }) => {
        if (value.collaboration?.conversationID === session.conversationID) {
          void refresh();
        }
      },
    );
  }, [refresh, session.conversationID]);

  const collaboration = collaborations[0];
  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    runAction(async () => {
      const value = objective.trim();
      if (!value) throw new Error("Enter a collaboration objective");
      const api = window.electronAPI;
      if (!api) throw new Error("Electron collaboration bridge is unavailable");
      const workerAgents = agents.slice(0, Math.min(2, agents.length));
      const workerAgent = workerAgents[0];
      if (!workerAgent) throw new Error("No online Agent can execute runs");
      const reviewerAgent =
        agents.find(
          (agent) => !workerAgents.some((worker) => worker.agentID === agent.agentID),
        ) ?? workerAgent;
      const humanID = self.userID || "local-human";
      const created = await api.ipcInvoke<{
        collaboration: CollaborationSession;
      }>("agent-collaboration:create", {
        conversationID: session.conversationID,
        sessionID: session.id,
        idempotencyKey: `ui:${session.id}:${crypto.randomUUID()}`,
        objective: value,
        participants: [
          {
            participantID: `human-driver:${humanID}`,
            kind: "human",
            principalID: humanID,
            displayName: self.nickname || humanID,
            role: "driver",
          },
          ...workerAgents.map((agent) => ({
            participantID: `agent-worker:${agent.agentID}`,
            kind: "agent",
            principalID: agent.agentID,
            displayName: agent.displayName,
            role: "worker",
            agentID: agent.agentID,
          })),
          {
            participantID: `agent-reviewer:${reviewerAgent.agentID}`,
            kind: "agent",
            principalID: reviewerAgent.agentID,
            displayName: `${reviewerAgent.displayName} Reviewer`,
            role: "reviewer",
            agentID: reviewerAgent.agentID,
          },
        ],
      });
      const collaborationID = created.collaboration.collaborationID;
      await api.ipcInvoke("agent-collaboration:delegate", {
        collaborationID,
        driverParticipantID: `human-driver:${humanID}`,
        delegationKey: `ui-initial:${collaborationID}`,
        tasks: workerAgents.map((agent, index) => ({
          title: index === 0 ? value : `Independent risk analysis: ${value}`,
          instruction:
            index === 0
              ? value
              : `Independently analyze risks, gaps, and validation needs for: ${value}`,
          assigneeParticipantID: `agent-worker:${agent.agentID}`,
          risk: "medium",
        })),
      });
      await api.ipcInvoke("agent-collaboration:dispatch", {
        collaborationID,
        requestedByParticipantID: `human-driver:${humanID}`,
      });
      setObjective("");
    });

  if (!collaboration) {
    return (
      <div
        data-testid="agent-collaboration-card"
        className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:bg-blue-950/20"
      >
        <div className="mb-2 font-medium">Distributed collaboration</div>
        <div className="mb-2 text-xs text-[var(--sub-text)]">
          Start a worker/reviewer flow bound to this OpenIM conversation. Results remain
          in the Agent panel until a human approves and sends them.
        </div>
        <div className="flex gap-2">
          <Input
            size="small"
            value={objective}
            placeholder="Collaboration objective"
            onChange={(event) => setObjective(event.target.value)}
          />
          <Button
            size="small"
            type="primary"
            loading={busy}
            disabled={!agents.length}
            onClick={() => void start()}
          >
            Start
          </Button>
        </div>
      </div>
    );
  }

  const participantByID = new Map(
    collaboration.participants.map((participant) => [
      participant.participantID,
      participant,
    ]),
  );
  const workerParticipantIDs = new Set(
    collaboration.participants
      .filter((participant) => participant.role === "worker")
      .map((participant) => participant.participantID),
  );
  const workerTasks = collaboration.tasks.filter((task) =>
    workerParticipantIDs.has(task.assigneeParticipantID),
  );
  const hasActiveReview = collaboration.tasks.some(
    (task) =>
      participantByID.get(task.assigneeParticipantID)?.role === "reviewer" &&
      (task.status === "queued" || task.status === "running"),
  );
  const canBeginReview =
    collaboration.status === "running" &&
    workerTasks.length > 0 &&
    workerTasks.every((task) => task.status === "completed") &&
    !hasActiveReview;
  const driver = collaboration.participants.find(
    (participant) => participant.role === "driver",
  );
  const pendingHuman =
    collaboration.status === "waiting_human" &&
    collaboration.intervention &&
    !collaboration.intervention.resolvedAt;

  const beginReview = () =>
    runAction(async () => {
      if (!driver) throw new Error("Collaboration driver is missing");
      const api = window.electronAPI;
      if (!api) throw new Error("Electron collaboration bridge is unavailable");
      await api.ipcInvoke("agent-collaboration:beginReview", {
        collaborationID: collaboration.collaborationID,
        driverParticipantID: driver.participantID,
      });
      await api.ipcInvoke("agent-collaboration:dispatch", {
        collaborationID: collaboration.collaborationID,
        requestedByParticipantID: driver.participantID,
      });
    });

  const resolveHuman = (decision: "approve" | "reject" | "instruct") =>
    runAction(async () => {
      if (!driver || driver.kind !== "human") {
        throw new Error("A human driver must make the final decision");
      }
      if (decision === "instruct" && !instruction.trim()) {
        throw new Error("Enter revision instructions");
      }
      const api = window.electronAPI;
      if (!api) throw new Error("Electron collaboration bridge is unavailable");
      await api.ipcInvoke("agent-collaboration:resolveHuman", {
        collaborationID: collaboration.collaborationID,
        humanParticipantID: driver.participantID,
        decision,
        instruction: instruction.trim() || undefined,
      });
      if (decision === "instruct") {
        await api.ipcInvoke("agent-collaboration:dispatch", {
          collaborationID: collaboration.collaborationID,
          requestedByParticipantID: driver.participantID,
        });
      }
      setInstruction("");
    });

  return (
    <div
      data-testid="agent-collaboration-card"
      className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:bg-violet-950/20"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Distributed collaboration</div>
        <Tag>{collaboration.status}</Tag>
      </div>
      <div className="mt-1 text-xs">{collaboration.objective}</div>
      <div className="mt-2 space-y-1 text-xs">
        {collaboration.tasks.map((task) => (
          <div key={task.taskID} className="flex items-center justify-between gap-2">
            <span className="truncate">{task.title}</span>
            <Tag>{task.status}</Tag>
          </div>
        ))}
      </div>
      {canBeginReview && (
        <Button
          className="mt-2"
          size="small"
          type="primary"
          loading={busy}
          onClick={() => void beginReview()}
        >
          Start reviewer
        </Button>
      )}
      {pendingHuman && (
        <div className="mt-2 border-t border-violet-200 pt-2">
          <div className="mb-2 text-xs">{collaboration.intervention?.reason}</div>
          <Input.TextArea
            value={instruction}
            placeholder="Optional final wording, or required revision instructions"
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="small"
              type="primary"
              loading={busy}
              onClick={() => void resolveHuman("approve")}
            >
              Approve final
            </Button>
            <Button
              size="small"
              disabled={!instruction.trim()}
              onClick={() => void resolveHuman("instruct")}
            >
              Request revision
            </Button>
            <Button size="small" danger onClick={() => void resolveHuman("reject")}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {collaboration.status === "completed" && collaboration.finalSummary && (
        <div className="mt-2 text-xs">Human-approved: {collaboration.finalSummary}</div>
      )}
    </div>
  );
};

const AgentPanel = ({
  conversationIDOverride,
}: {
  conversationIDOverride?: string;
}) => {
  const { conversationID: routeConversationID } = useParams();
  const conversationID = conversationIDOverride ?? routeConversationID;
  const sessions = useAgentSessionStore((state) => state.sessions);
  const activeMap = useAgentSessionStore((state) => state.activeSessionByConversation);
  const botRequests = useAgentSessionStore((state) => state.botRequests);
  const botPolicy = useAgentSessionStore(
    (state) => state.botPolicyByConversation[conversationID ?? ""] ?? "review",
  );
  const botContextLimit = useAgentSessionStore(
    (state) => state.botContextLimitByConversation[conversationID ?? ""] ?? 20,
  );
  const autoApprove = useAgentSessionStore((state) => state.autoApproveBySession);
  const pendingDraft = useAgentSessionStore((state) =>
    activeMap[conversationID ?? ""]
      ? state.pendingDraftBySession[activeMap[conversationID ?? ""]!]
      : "",
  );
  const [prompt, setPrompt] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("New Agent session");
  const [workspacePath, setWorkspacePath] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [contextLimit, setContextLimit] = useState(20);
  const [creating, setCreating] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const conversationSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) => session.conversationID === conversationID && !session.archived,
        )
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt,
        ),
    [conversationID, sessions],
  );
  const activeSession =
    conversationSessions.find(
      (session) => session.id === activeMap[conversationID ?? ""],
    ) ?? conversationSessions[0];
  const pendingRequests = botRequests.filter(
    (request) =>
      request.conversationID === conversationID && request.status === "pending_review",
  );

  useEffect(() => {
    if (!conversationID) return;
    if (activeSession && activeMap[conversationID] !== activeSession.id) {
      void useAgentSessionStore
        .getState()
        .selectSession(conversationID, activeSession.id);
    }
  }, [activeMap, activeSession, conversationID]);

  useEffect(() => {
    void useAgentSessionStore.getState().setViewport({
      conversationID,
      sessionID: activeSession?.id,
      visible: Boolean(conversationID && activeSession),
    });
    if (activeSession) void useAgentSessionStore.getState().markRead(activeSession.id);
    return () => {
      void useAgentSessionStore.getState().setViewport({ visible: false });
    };
  }, [activeSession?.id, conversationID]);

  useEffect(() => {
    if (!activeSession || !pendingDraft) return;
    setPrompt((current) => `${current}${current ? "\n\n" : ""}${pendingDraft}`);
    useAgentSessionStore.getState().consumeDraft(activeSession.id);
  }, [activeSession, pendingDraft]);

  useEffect(() => {
    if (!activeSession) {
      setModelOptions([]);
      return;
    }
    let current = true;
    setModelsLoading(true);
    void useAgentSessionStore
      .getState()
      .listModels(activeSession.id)
      .then((options) => {
        if (current) setModelOptions(options);
      })
      .catch((error) => {
        if (current) {
          setModelOptions([]);
          message.error(
            `Cannot load Agent models: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })
      .finally(() => {
        if (current) setModelsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [activeSession?.id]);

  const create = async () => {
    if (!conversationID) return;
    setCreating(true);
    try {
      const id = await useAgentSessionStore.getState().createSession({
        conversationID,
        title,
        workspacePath: workspacePath || undefined,
      });
      if (id) await useAgentSessionStore.getState().selectSession(conversationID, id);
      setCreateOpen(false);
      setWorkspacePath("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const pickWorkspace = async () => {
    const folder = await window.electronAPI?.ipcInvoke<
      { folderPath: string; folderName: string } | undefined
    >("file:selectFolder");
    if (folder) setWorkspacePath(folder.folderPath);
  };

  const send = async () => {
    const value = prompt.trim();
    if (!activeSession || !value) return;
    setPrompt("");
    try {
      await useAgentSessionStore.getState().sendMessage({
        sessionID: activeSession.id,
        text: value,
      });
    } catch (error) {
      setPrompt(value);
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const addContext = async () => {
    if (!activeSession || !conversationID) return;
    try {
      const messages = await loadRecentConversationMessages(
        conversationID,
        contextLimit,
      );
      const result = await persistAgentContextBundle({
        session: activeSession,
        source: { kind: "recentMessages", conversationID, limit: contextLimit },
        messages,
      });
      setPrompt(
        (current) => `${current}${current ? "\n\n" : ""}${result.bundle.promptText}`,
      );
      setContextOpen(false);
      message.success("Auditable IM context snapshot added");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!conversationID) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--chat-bubble)]">
        <Empty description="Select a contact" />
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-w-0 flex-col bg-[var(--chat-bubble)]"
      data-testid="agent-panel"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/5 px-3 dark:border-white/10">
        <div className="min-w-0">
          {activeSession ? (
            <Select
              bordered={false}
              className="max-w-[220px] font-medium"
              value={activeSession.id}
              options={conversationSessions.map((session) => ({
                value: session.id,
                label: `${session.kind === "bot" ? "Bot · " : ""}${
                  session.pinned ? "📌 " : ""
                }${session.title}`,
              }))}
              onChange={(sessionID) =>
                conversationID &&
                void useAgentSessionStore
                  .getState()
                  .selectSession(conversationID, sessionID)
              }
            />
          ) : (
            <div className="truncate font-medium">Agent workspace</div>
          )}
          {activeSession && (
            <Tag color={statusColor[activeSession.status]}>{activeSession.status}</Tag>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          {activeSession && (
            <>
              <Tooltip title={activeSession.pinned ? "Unpin" : "Pin"}>
                <Button
                  type="text"
                  icon={
                    activeSession.pinned ? (
                      <PushpinFilled rev={undefined} />
                    ) : (
                      <PushpinOutlined rev={undefined} />
                    )
                  }
                  onClick={() =>
                    void useAgentSessionStore.getState().updateSession({
                      sessionID: activeSession.id,
                      pinned: !activeSession.pinned,
                    })
                  }
                />
              </Tooltip>
              <Button
                type="text"
                size="small"
                onClick={() => {
                  setRenameTitle(activeSession.title);
                  setRenameOpen(true);
                }}
              >
                Rename
              </Button>
              <Tooltip title="Archive (files and OpenCode history are kept)">
                <Button
                  type="text"
                  icon={<DeleteOutlined rev={undefined} />}
                  onClick={() =>
                    Modal.confirm({
                      title: "Archive this Agent session?",
                      content: "The workspace and OpenCode history will be kept.",
                      onOk: () =>
                        useAgentSessionStore
                          .getState()
                          .archiveSession(activeSession.id),
                    })
                  }
                />
              </Tooltip>
            </>
          )}
          <Button type="primary" size="small" onClick={() => setCreateOpen(true)}>
            New
          </Button>
        </div>
      </header>

      {activeSession ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-black/5 px-3 py-2 text-xs dark:border-white/10">
            <label className="flex items-center gap-1">
              Model
              <Select
                size="small"
                showSearch
                loading={modelsLoading}
                placeholder="Select model"
                className="min-w-[190px] max-w-[260px]"
                value={
                  activeSession.model
                    ? `${activeSession.model.providerID}::${activeSession.model.modelID}`
                    : undefined
                }
                optionFilterProp="label"
                options={modelOptions
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(b.isDefault) - Number(a.isDefault) ||
                      a.providerName.localeCompare(b.providerName) ||
                      a.modelName.localeCompare(b.modelName),
                  )
                  .map((option) => ({
                    value: `${option.providerID}::${option.modelID}`,
                    label: `${option.providerName} · ${option.modelName}${
                      option.isDefault ? " (default)" : ""
                    }`,
                  }))}
                onChange={(value) => {
                  const option = modelOptions.find(
                    (item) => `${item.providerID}::${item.modelID}` === value,
                  );
                  if (!option) return;
                  void useAgentSessionStore.getState().updateSession({
                    sessionID: activeSession.id,
                    model: {
                      providerID: option.providerID,
                      modelID: option.modelID,
                    },
                  });
                }}
                data-testid="agent-model-select"
              />
            </label>
            <label className="flex items-center gap-1">
              Bot requests
              <Select
                size="small"
                value={botPolicy}
                className="w-[86px]"
                options={[
                  { value: "off", label: "Off" },
                  { value: "review", label: "Review" },
                  { value: "auto", label: "Auto" },
                ]}
                onChange={(value) => {
                  const apply = () =>
                    conversationID &&
                    useAgentSessionStore
                      .getState()
                      .setBotPolicy(conversationID, value, botContextLimit);
                  if (value === "auto") {
                    Modal.confirm({
                      title: "Auto-run explicit @bot requests?",
                      content:
                        "Only explicit @bot @you messages are accepted. Results are never sent back to IM automatically.",
                      onOk: apply,
                    });
                  } else {
                    void apply();
                  }
                }}
              />
            </label>
            <label className="flex items-center gap-1">
              Context
              <InputNumber
                size="small"
                min={1}
                max={200}
                className="w-[64px]"
                value={botContextLimit}
                onChange={(value) => {
                  if (conversationID && value) {
                    void useAgentSessionStore
                      .getState()
                      .setBotPolicy(conversationID, botPolicy, value);
                  }
                }}
              />
            </label>
            <label className="flex items-center gap-1">
              Live IM history
              <Switch
                size="small"
                checked={activeSession.liveHistoryEnabled}
                onChange={(checked) =>
                  void useAgentSessionStore.getState().updateSession({
                    sessionID: activeSession.id,
                    liveHistoryEnabled: checked,
                  })
                }
              />
            </label>
            <label className="flex items-center gap-1">
              Auto approve
              <Switch
                size="small"
                checked={Boolean(autoApprove[activeSession.id])}
                onChange={(checked) =>
                  void useAgentSessionStore
                    .getState()
                    .setAutoApprove(activeSession.id, checked)
                }
              />
            </label>
            <label className="flex items-center gap-1">
              Auto send reply
              <Switch
                size="small"
                checked={Boolean(activeSession.autoReplyTextEnabled)}
                onChange={(checked) => {
                  const apply = () =>
                    useAgentSessionStore.getState().updateSession({
                      sessionID: activeSession.id,
                      autoReplyTextEnabled: checked,
                    });
                  if (!checked) {
                    void apply();
                    return;
                  }
                  Modal.confirm({
                    title: "Send Agent replies without confirmation?",
                    content:
                      "New replies from this Agent session will be sent automatically to its bound IM conversation, even when you switch to another contact.",
                    okText: "Enable auto send",
                    cancelText: "Cancel",
                    onOk: apply,
                  });
                }}
                data-testid="agent-auto-send-reply"
              />
            </label>
            <label className="flex items-center gap-1">
              Auto attach outputs
              <Switch
                size="small"
                checked={Boolean(activeSession.autoFileAttachmentEnabled)}
                onChange={(checked) => {
                  const apply = () =>
                    useAgentSessionStore.getState().updateSession({
                      sessionID: activeSession.id,
                      autoFileAttachmentEnabled: checked,
                    });
                  if (!checked) {
                    void apply();
                    return;
                  }
                  Modal.confirm({
                    title: "Automatically send output files and folders?",
                    content:
                      "Files and folders listed by this Agent under Output Files or Output Folders will be uploaded to its bound IM conversation without another confirmation.",
                    okText: "Enable auto attachments",
                    cancelText: "Cancel",
                    onOk: apply,
                  });
                }}
                data-testid="agent-auto-attach-output"
              />
            </label>
            <span
              className="truncate text-[var(--sub-text)]"
              title={activeSession.workspacePath}
            >
              {activeSession.managedWorkspace
                ? "Managed workspace"
                : activeSession.workspacePath}
            </span>
          </div>
          <div className="max-h-48 shrink-0 overflow-y-auto px-3 pt-3">
            <CollaborationCard session={activeSession} />
          </div>
          <Virtuoso
            className="min-h-0 flex-1"
            data={activeSession.messages}
            followOutput={() => "smooth"}
            initialTopMostItemIndex={Math.max(activeSession.messages.length - 1, 0)}
            itemContent={(_, agentMessage) => (
              <div className="px-3 first:pt-3">
                <MessageCard agentMessage={agentMessage} session={activeSession} />
              </div>
            )}
            components={{
              EmptyPlaceholder: () => (
                <div className="flex h-full min-h-[240px] flex-col px-3">
                  <div className="flex flex-1 items-center justify-center">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Start a persistent Agent conversation"
                    />
                  </div>
                </div>
              ),
              Header: () => (
                <div className="px-3 pt-3">
                  {pendingRequests.map((request) => (
                    <BotRequestCard key={request.id} request={request} />
                  ))}
                  <RuntimeStatusCard session={activeSession} />
                  <RuntimeRetryCard session={activeSession} />
                  {activeSession.messages.length === 0 &&
                    activeSession.interactions.length === 0 &&
                    pendingRequests.length === 0 && (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="Start a persistent Agent conversation"
                      />
                    )}
                </div>
              ),
              Footer: () => (
                <div className="px-3 pb-3">
                  {activeSession.interactions.map((interaction) => (
                    <InteractionCard
                      key={interaction.id}
                      interaction={interaction}
                      sessionID={activeSession.id}
                    />
                  ))}
                </div>
              ),
            }}
          />
          <footer className="shrink-0 border-t border-black/5 p-3 dark:border-white/10">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={prompt}
              placeholder={
                activeSession.status === "running"
                  ? "Send another message (it will be queued)"
                  : "Message Agent"
              }
              onChange={(event) => setPrompt(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <Button size="small" onClick={() => setContextOpen(true)}>
                Add IM context
              </Button>
              <div>
                {activeSession.status === "running" && (
                  <Button
                    className="mr-2"
                    danger
                    size="small"
                    icon={<StopOutlined rev={undefined} />}
                    onClick={() =>
                      void useAgentSessionStore.getState().abort(activeSession.id)
                    }
                  >
                    Stop
                  </Button>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined rev={undefined} />}
                  disabled={!prompt.trim() || !activeSession.runtimeSessionID}
                  onClick={() => void send()}
                >
                  Send
                </Button>
              </div>
            </div>
          </footer>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {pendingRequests.map((request) => (
            <BotRequestCard key={request.id} request={request} />
          ))}
          <div className="flex min-h-[240px] items-center justify-center">
            <Empty description="No Agent session for this contact">
              <Button type="primary" onClick={() => setCreateOpen(true)}>
                Create Agent session
              </Button>
            </Empty>
          </div>
        </div>
      )}

      <Modal
        title="New Agent session"
        open={createOpen}
        confirmLoading={creating}
        onOk={() => void create()}
        onCancel={() => setCreateOpen(false)}
      >
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Session title"
        />
        <Input
          className="mt-3"
          value={workspacePath}
          readOnly
          placeholder="Managed workspace (default)"
          addonAfter={
            <Button type="text" size="small" onClick={() => void pickWorkspace()}>
              Choose existing…
            </Button>
          }
        />
        <div className="mt-2 text-xs text-[var(--sub-text)]">
          An independent managed workspace is created by default. Existing directories
          are never deleted.
        </div>
      </Modal>
      <Modal
        title="Add recent IM context"
        open={contextOpen}
        onOk={() => void addContext()}
        onCancel={() => setContextOpen(false)}
      >
        <Select
          value={contextLimit}
          onChange={setContextLimit}
          options={[20, 50, 100].map((value) => ({
            value,
            label: `Most recent ${value} messages`,
          }))}
          className="w-full"
        />
        <div className="mt-3 text-sm text-[var(--sub-text)]">
          A Markdown snapshot and manifest will be written to this Agent workspace.
          Nothing is sent back to IM automatically.
        </div>
      </Modal>
      <Modal
        title="Rename Agent session"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={() => {
          if (!activeSession || !renameTitle.trim()) return;
          void useAgentSessionStore
            .getState()
            .updateSession({ sessionID: activeSession.id, title: renameTitle.trim() });
          setRenameOpen(false);
        }}
      >
        <Input
          value={renameTitle}
          onChange={(event) => setRenameTitle(event.target.value)}
        />
      </Modal>
    </section>
  );
};

export default AgentPanel;
