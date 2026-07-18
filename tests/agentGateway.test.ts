import assert from "node:assert/strict";

import { AgentGateway, InMemoryAgentGatewayStateStore } from "../src/agent-core";

let now = 1000;
let nextID = 0;
const store = new InMemoryAgentGatewayStateStore();
const createGateway = () =>
  new AgentGateway(store, {
    heartbeatTtlMs: 100,
    now: () => now,
    createID: () => `run-${++nextID}`,
  });

const run = async () => {
  const gateway = createGateway();
  await gateway.initialize();
  await gateway.registerAgent({
    agentID: "worker-1",
    runtimeID: "opencode",
    displayName: "Worker 1",
    endpoint: "stdio://worker-1",
    capabilities: ["session.create", "run.execute", "run.streaming"],
  });
  await gateway.registerAgent({
    agentID: "reviewer-1",
    runtimeID: "remote-reviewer",
    displayName: "Reviewer 1",
    endpoint: "https://reviewer.example",
    capabilities: ["run.execute"],
  });

  assert.deepEqual(
    gateway
      .discoverAgents({ capability: "run.streaming" })
      .map((agent) => agent.agentID),
    ["worker-1"],
  );

  const createdSession = await gateway.createSession({
    conversationID: "conversation-1",
    sessionID: "session-1",
    actor: { type: "human", id: "user-1" },
    metadata: { source: "openim-conversation" },
  });
  const duplicateSession = await gateway.createSession({
    conversationID: "conversation-1",
    sessionID: "session-1",
    actor: { type: "human", id: "user-1" },
  });
  assert.equal(createdSession.created, true);
  assert.equal(duplicateSession.created, false);
  assert.equal(gateway.getSession("session-1")?.status, "active");
  assert.equal(gateway.listSessions({ conversationID: "conversation-1" }).length, 1);

  const first = await gateway.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "message-1",
    input: { prompt: "implement" },
    actor: { type: "human", id: "user-1" },
  });
  const duplicate = await gateway.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "message-1",
    input: { prompt: "must not replace the first input" },
    actor: { type: "human", id: "user-1" },
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.run.runID, first.run.runID);
  assert.deepEqual(duplicate.run.input, { prompt: "implement" });

  const started = await gateway.appendRunEvent({
    eventID: "event-started",
    runID: first.run.runID,
    state: "running",
  });
  const repeated = await gateway.appendRunEvent({
    eventID: "event-started",
    runID: first.run.runID,
    state: "running",
  });
  const completed = await gateway.appendRunEvent({
    eventID: "event-completed",
    runID: first.run.runID,
    state: "completed",
    payload: { summary: "done" },
  });
  assert.equal(started.event.sequence, 0);
  assert.equal(repeated.appended, false);
  assert.equal(completed.event.sequence, 1);
  assert.equal(gateway.getRun(first.run.runID)?.status, "completed");
  await assert.rejects(
    () =>
      gateway.appendRunEvent({
        eventID: "event-after-completed",
        runID: first.run.runID,
        state: "delta",
      }),
    /terminal run/,
  );

  const retryCandidate = await gateway.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "message-2",
    input: { prompt: "retry me" },
    maxAttempts: 2,
    actor: { type: "agent", id: "driver-1" },
  });
  await gateway.appendRunEvent({
    eventID: "event-failed",
    runID: retryCandidate.run.runID,
    state: "failed",
  });
  now = 1010;
  const retry = await gateway.retryRun(retryCandidate.run.runID, {
    delayMs: 50,
    lastError: "provider unavailable",
  });
  assert.equal(retry.scheduled, true);
  assert.equal(retry.run.attempt, 2);
  assert.equal(retry.run.nextRetryAt, 1060);
  await gateway.appendRunEvent({
    eventID: "event-failed-again",
    runID: retryCandidate.run.runID,
    state: "failed",
  });
  assert.equal((await gateway.retryRun(retryCandidate.run.runID)).scheduled, false);

  await assert.rejects(
    () =>
      gateway.createRun({
        conversationID: "conversation-1",
        sessionID: "session-1",
        targetAgentID: "worker-1",
        idempotencyKey: "high-risk-without-human",
        input: { prompt: "deploy production" },
        actor: { type: "agent", id: "driver-1" },
        risk: "high",
      }),
    /requires human approval/,
  );
  await assert.rejects(
    () =>
      gateway.createRun({
        conversationID: "conversation-1",
        sessionID: "session-1",
        targetAgentID: "worker-1",
        idempotencyKey: "high-risk-with-stale-human",
        input: { prompt: "deploy production" },
        actor: { type: "agent", id: "driver-1" },
        risk: "high",
        humanApproval: {
          approverID: "user-1",
          approvedAt: now - 5 * 60_000 - 1,
        },
      }),
    /requires human approval/,
  );
  await assert.rejects(
    () =>
      gateway.authorizeAction({
        action: "unknown.action" as never,
        actorType: "human",
        actorID: "user-1",
        risk: "low",
      }),
    /Unsupported gateway governance action/,
  );
  const approved = await gateway.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "high-risk-with-human",
    input: { prompt: "deploy production" },
    actor: { type: "agent", id: "driver-1" },
    risk: "high",
    humanApproval: { approverID: "user-1", approvedAt: now },
  });
  assert.equal(approved.created, true);
  assert.deepEqual(
    gateway
      .listAuditRecords({ conversationID: "conversation-1" })
      .slice(-2)
      .map((audit) => audit.decision),
    ["require_human", "allow"],
  );
  assert.equal(gateway.getMetrics().audits.requireHuman, 2);
  assert.equal(gateway.getMetrics().retries, 1);
  assert.deepEqual(gateway.getMetrics().sessions, { active: 1, closed: 0 });
  await assert.rejects(
    () =>
      gateway.abortRun({
        runID: approved.run.runID,
        actor: { type: "agent", id: "driver-1" },
        risk: "high",
        reason: "unsafe",
      }),
    /requires human approval/,
  );
  assert.equal(
    (
      await gateway.abortRun({
        runID: approved.run.runID,
        actor: { type: "human", id: "user-1" },
        risk: "high",
        humanApproval: { approverID: "user-1", approvedAt: now },
        reason: "human stopped the run",
      })
    ).run.status,
    "aborted",
  );

  now = 1100;
  assert.deepEqual(await gateway.sweepExpiredAgents(), ["worker-1", "reviewer-1"]);
  assert.deepEqual(gateway.discoverAgents(), []);
  assert.equal(gateway.discoverAgents({ includeOffline: true }).length, 2);

  now = 1110;
  await gateway.heartbeat("worker-1");
  assert.equal(gateway.discoverAgents()[0]?.status, "online");

  const claimCandidate = await gateway.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "claim-and-recover",
    input: { prompt: "lease me" },
    actor: { type: "human", id: "user-1" },
  });
  assert.equal(
    gateway
      .listRuns({ targetAgentID: "worker-1", availableOnly: true })
      .some((item) => item.runID === claimCandidate.run.runID),
    true,
  );
  await assert.rejects(
    () =>
      gateway.claimRun({
        runID: claimCandidate.run.runID,
        agentID: "reviewer-1",
      }),
    /target agent/,
  );
  const claim = await gateway.claimRun({
    runID: claimCandidate.run.runID,
    agentID: "worker-1",
    leaseMs: 1000,
  });
  assert.equal(claim.claimed, true);
  assert.equal(claim.run.status, "running");
  assert.equal(
    (
      await gateway.claimRun({
        runID: claimCandidate.run.runID,
        agentID: "worker-1",
      })
    ).claimed,
    false,
  );
  now = 2111;
  const recoveredClaims = await gateway.recoverExpiredRunClaims();
  assert.equal(recoveredClaims[0]?.status, "queued");
  assert.equal(recoveredClaims[0]?.attempt, 2);
  assert.deepEqual(
    gateway.listRunEvents(claimCandidate.run.runID).map((event) => event.state),
    ["running", "queued"],
  );

  const restored = createGateway();
  await restored.initialize();
  assert.equal(
    restored.getSession("session-1")?.metadata?.source,
    "openim-conversation",
  );
  assert.equal(restored.getRun(first.run.runID)?.status, "completed");
  assert.deepEqual(
    restored.listRunEvents(first.run.runID).map((event) => event.sequence),
    [0, 1],
  );
  const restoredDuplicate = await restored.createRun({
    conversationID: "conversation-1",
    sessionID: "session-1",
    targetAgentID: "worker-1",
    idempotencyKey: "message-1",
    input: {},
    actor: { type: "human", id: "user-1" },
  });
  assert.equal(restoredDuplicate.created, false);

  const closed = await restored.closeSession({
    sessionID: "session-1",
    actor: { type: "human", id: "user-1" },
  });
  assert.equal(closed.closed, true);
  assert.deepEqual(restored.getMetrics().sessions, { active: 0, closed: 1 });
  await assert.rejects(
    () =>
      restored.createRun({
        conversationID: "conversation-1",
        sessionID: "session-1",
        targetAgentID: "worker-1",
        idempotencyKey: "closed-session-run",
        input: {},
        actor: { type: "human", id: "user-1" },
      }),
    /Session is closed/,
  );

  const legacyStore = new InMemoryAgentGatewayStateStore();
  const legacySnapshot = restored.snapshot();
  legacySnapshot.version = 1;
  delete legacySnapshot.sessions;
  legacyStore.snapshot = legacySnapshot;
  const migrated = new AgentGateway(legacyStore);
  await migrated.initialize();
  assert.equal(migrated.getSession("session-1")?.status, "active");
  assert.equal(
    migrated.getSession("session-1")?.metadata?.migratedFromSnapshotVersion,
    1,
  );

  console.log("Agent gateway state and recovery contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
