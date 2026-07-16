import {
  CopyOutlined,
  DeleteOutlined,
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
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";

import { executeAgentBotRequest } from "@/services/agentSessions/botRouter";
import {
  loadRecentConversationMessages,
  persistAgentContextBundle,
} from "@/services/agentSessions/context";
import { useAgentSessionStore } from "@/store";
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
        <div
          className={clsx(
            "transition-opacity",
            agentMessage.role === "assistant"
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Tooltip title="Copy">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined rev={undefined} />}
              onClick={() => void navigator.clipboard.writeText(text)}
            />
          </Tooltip>
          <Button
            size="small"
            type="link"
            onClick={() => emit("APPEND_CHAT_INPUT", text)}
          >
            Insert to IM
          </Button>
          {agentMessage.role === "assistant" && replyText && (
            <Button
              size="small"
              type="link"
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
            >
              Send to IM
            </Button>
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
          <SafeMarkdown key={part.id} text={part.text ?? ""} />
        ),
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
    <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:bg-blue-950/20">
      <div className="mb-1 text-xs text-[var(--sub-text)]">
        Bot request from {request.senderNickname ?? request.senderUserID}
      </div>
      <div className="mb-2 text-sm">
        {request.instructionText || "(no instruction)"}
      </div>
      <Button size="small" type="primary" loading={running} onClick={() => void run()}>
        Review and run
      </Button>
      <Button
        size="small"
        className="ml-2"
        onClick={() =>
          void useAgentSessionStore.getState().ignoreBotRequest(request.id)
        }
      >
        Ignore
      </Button>
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
                label: `${session.pinned ? "📌 " : ""}${session.title}`,
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
            <span
              className="truncate text-[var(--sub-text)]"
              title={activeSession.workspacePath}
            >
              {activeSession.managedWorkspace
                ? "Managed workspace"
                : activeSession.workspacePath}
            </span>
          </div>
          <Virtuoso
            className="min-h-0 flex-1"
            data={activeSession.messages}
            followOutput="smooth"
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
