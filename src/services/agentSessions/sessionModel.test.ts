import assert from "node:assert/strict";

import type { AgentSession, AgentTurn } from "../../types/agentSession";
import {
  aggregateConversationAgentState,
  cancelUnfinishedTurns,
  getNextQueuedTurn,
  resolveConversationSession,
  sortAgentSessions,
} from "./sessionModel";

const turn = (
  id: string,
  status: AgentTurn["status"],
  createdAt: number,
): AgentTurn => ({
  id,
  requestID: `request-${id}`,
  runID: `run-${id}`,
  sessionID: "session-1",
  requesterUserID: "requester-1",
  source: "manual",
  prompt: id,
  contextPolicy: {
    ownerUserID: "requester-1",
    recentMessageLimit: 20,
    includeAttachments: true,
    allowedConversationIDs: ["conversation-1"],
  },
  authorizedContextMessageCount: 0,
  status,
  createdAt,
  updatedAt: createdAt,
});

const session = (patch: Partial<AgentSession> & { id: string }): AgentSession => ({
  conversationID: "conversation-1",
  kind: "manual",
  title: patch.id,
  runtime: "opencode",
  workspacePath: `C:/workspace/${patch.id}`,
  managedWorkspace: true,
  status: "idle",
  pinned: false,
  archived: false,
  unreadCount: 0,
  liveHistoryEnabled: true,
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  messages: [],
  turns: [],
  interactions: [],
  stagedResults: [],
  traceSummaries: [],
  ...patch,
  id: patch.id,
});

{
  const turns = [
    turn("done", "completed", 1),
    turn("first", "queued", 2),
    turn("second", "queued", 3),
  ];
  assert.equal(
    getNextQueuedTurn(turns)?.id,
    "first",
    "FIFO chooses the oldest queued turn",
  );
}

{
  const restored = cancelUnfinishedTurns(
    [
      turn("running", "running", 1),
      turn("queued", "queued", 2),
      turn("done", "completed", 3),
    ],
    100,
    "restart",
  );
  assert.deepEqual(
    restored.map((item) => item.status),
    ["cancelled", "cancelled", "completed"],
    "restart recovery never replays unfinished prompts",
  );
  assert.equal(restored[0].lastError, "restart");
}

{
  const recent = session({ id: "recent", lastOpenedAt: 20 });
  const pinned = session({ id: "pinned", pinned: true, lastOpenedAt: 1 });
  assert.deepEqual(
    sortAgentSessions([recent, pinned]).map((item) => item.id),
    ["pinned", "recent"],
  );
  assert.equal(
    resolveConversationSession([recent, pinned], "conversation-1", "recent")?.id,
    "recent",
  );
  assert.equal(
    resolveConversationSession([recent, pinned], "conversation-1", "missing")?.id,
    "pinned",
  );
}

{
  const state = aggregateConversationAgentState(
    [
      session({ id: "run", status: "running", unreadCount: 1 }),
      session({ id: "wait", turns: [turn("queued", "queued", 1)], unreadCount: 2 }),
      session({ id: "error", status: "error" }),
    ],
    2,
  );
  assert.deepEqual(state, { running: 1, waiting: 3, errors: 1, unread: 3 });
}

console.log("Agent session model tests passed");
