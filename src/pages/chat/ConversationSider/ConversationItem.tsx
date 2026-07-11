import { PushpinFilled } from "@ant-design/icons";
import type {
  ConversationItem,
  ConversationItem as ConversationItemType,
  MessageItem,
} from "@openim/wasm-client-sdk/lib/types/entity";
import { Badge, Tooltip } from "antd";
import clsx from "clsx";
import { t } from "i18next";
import { memo, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import OIMAvatar from "@/components/OIMAvatar";
import { useAgentSessionStore, useConversationStore, useUserStore } from "@/store";
import { formatConversionTime, getConversationContent } from "@/utils/imCommon";

import styles from "./conversation-item.module.scss";

interface IConversationProps {
  isActive: boolean;
  conversation: ConversationItemType;
}

const ConversationItem = ({ isActive, conversation }: IConversationProps) => {
  const navigate = useNavigate();
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const currentUser = useUserStore((state) => state.selfInfo.userID);
  const agentSessions = useAgentSessionStore((state) => state.sessions);
  const botRequests = useAgentSessionStore((state) => state.botRequests);
  const activeSessionID = useAgentSessionStore(
    (state) => state.activeSessionByConversation[conversation.conversationID],
  );

  const conversationAgentSessions = useMemo(
    () =>
      agentSessions
        .filter(
          (session) =>
            session.conversationID === conversation.conversationID && !session.archived,
        )
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt,
        ),
    [agentSessions, conversation.conversationID],
  );
  const agentAggregate = useMemo(
    () => ({
      running: conversationAgentSessions.filter(
        (session) => session.status === "running",
      ).length,
      waiting:
        conversationAgentSessions.filter(
          (session) =>
            session.status === "waiting_permission" ||
            session.status === "waiting_question" ||
            session.turns.some((turn) => turn.status === "queued"),
        ).length +
        botRequests.filter(
          (request) =>
            request.conversationID === conversation.conversationID &&
            request.status === "pending_review",
        ).length,
      errors: conversationAgentSessions.filter(
        (session) =>
          session.status === "error" || session.status === "recovery_required",
      ).length,
      unread: conversationAgentSessions.reduce(
        (total, session) => total + session.unreadCount,
        0,
      ),
    }),
    [botRequests, conversation.conversationID, conversationAgentSessions],
  );

  const toSpecifiedConversation = async () => {
    if (isActive) {
      return;
    }
    await updateCurrentConversation({ ...conversation });
    navigate(`/chat/${conversation.conversationID}`);
  };

  const latestMessageContent = useMemo(() => {
    let content = "";
    if (!conversation.latestMsg) {
      return "";
    }
    try {
      content = getConversationContent(
        JSON.parse(conversation.latestMsg) as MessageItem,
      );
    } catch (error) {
      content = escapeHtml(conversation.latestMsg);
    }
    return content;
  }, [conversation.draftText, conversation.latestMsg, isActive, currentUser]);

  const latestMessageTime = formatConversionTime(conversation.latestMsgSendTime);

  return (
    <div
      className={clsx(
        "relative my-1 rounded-md",
        isActive && "bg-[var(--primary-active)]",
      )}
    >
      <div
        className={clsx(styles["conversation-item"], "!my-0 border border-transparent")}
        onClick={toSpecifiedConversation}
      >
        <Badge size="small" count={conversation.unreadCount}>
          <OIMAvatar
            src={conversation.faceURL}
            isgroup={Boolean(conversation.groupID)}
            text={conversation.showName}
          />
        </Badge>

        <div className="ml-3 flex h-11 flex-1 flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex-1 truncate font-medium">{conversation.showName}</div>
            <div className="ml-2 text-xs text-[var(--sub-text)]">
              {latestMessageTime}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div className="flex min-h-[16px] flex-1 items-center overflow-hidden text-xs">
              <div
                className="truncate text-[rgba(81,94,112,0.5)]"
                dangerouslySetInnerHTML={{ __html: latestMessageContent }}
              />
            </div>
            {!isActive && agentAggregate.running > 0 && (
              <Tooltip title={`${agentAggregate.running} Agent session(s) running`}>
                <span className="h-2 w-2 rounded-full bg-blue-500" />
              </Tooltip>
            )}
            {!isActive && agentAggregate.waiting > 0 && (
              <Badge size="small" color="orange" count={agentAggregate.waiting} />
            )}
            {!isActive && agentAggregate.errors > 0 && (
              <Badge size="small" color="red" count={agentAggregate.errors} />
            )}
            {!isActive && agentAggregate.unread > 0 && (
              <Badge size="small" count={agentAggregate.unread} />
            )}
          </div>
        </div>
      </div>

      {isActive && conversationAgentSessions.length > 0 && (
        <div className="mb-1 ml-[54px] mr-2 max-h-[84px] overflow-y-auto rounded border border-black/5 bg-white/60 py-1 dark:border-white/10 dark:bg-black/10">
          {conversationAgentSessions.map((session) => (
            <button
              type="button"
              key={session.id}
              className={clsx(
                "flex h-7 w-full items-center gap-1 px-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5",
                session.id === activeSessionID && "text-[var(--primary)]",
              )}
              onClick={(event) => {
                event.stopPropagation();
                void useAgentSessionStore
                  .getState()
                  .selectSession(conversation.conversationID, session.id);
                void useAgentSessionStore
                  .getState()
                  .setPanelState({ agentPanelOpen: true });
              }}
              data-testid="conversation-agent-session"
            >
              <span
                className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", {
                  "bg-blue-500": session.status === "running",
                  "bg-orange-500":
                    session.status === "waiting_permission" ||
                    session.status === "waiting_question" ||
                    session.turns.some((turn) => turn.status === "queued"),
                  "bg-red-500":
                    session.status === "error" ||
                    session.status === "recovery_required",
                  "bg-green-500": session.status === "idle",
                  "bg-gray-400":
                    session.status === "creating" || session.status === "disconnected",
                })}
              />
              {session.pinned && <PushpinFilled rev={undefined} className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
              {session.unreadCount > 0 && (
                <Badge size="small" count={session.unreadCount} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(ConversationItem);

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
