import type { AgentSession, AgentTurn } from "../../types/agentSession";

export const sortAgentSessions = (items: AgentSession[]) =>
  [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastOpenedAt - a.lastOpenedAt || b.updatedAt - a.updatedAt;
  });

export const getNextQueuedTurn = (turns: AgentTurn[]) =>
  turns.find((turn) => turn.status === "queued");

export const cancelUnfinishedTurns = (turns: AgentTurn[], at: number, reason: string) =>
  turns.map((turn) =>
    turn.status === "queued" || turn.status === "running"
      ? { ...turn, status: "cancelled" as const, updatedAt: at, lastError: reason }
      : turn,
  );

export const resolveConversationSession = (
  sessions: AgentSession[],
  conversationID: string,
  preferredSessionID?: string,
) => {
  const available = sortAgentSessions(
    sessions.filter(
      (session) => session.conversationID === conversationID && !session.archived,
    ),
  );
  return available.find((session) => session.id === preferredSessionID) ?? available[0];
};

export const aggregateConversationAgentState = (
  sessions: AgentSession[],
  pendingBotRequests = 0,
) => ({
  running: sessions.filter((session) => session.status === "running").length,
  waiting:
    sessions.filter(
      (session) =>
        session.status === "waiting_permission" ||
        session.status === "waiting_question" ||
        session.turns.some((turn) => turn.status === "queued"),
    ).length + pendingBotRequests,
  errors: sessions.filter(
    (session) => session.status === "error" || session.status === "recovery_required",
  ).length,
  unread: sessions.reduce((total, session) => total + session.unreadCount, 0),
});
