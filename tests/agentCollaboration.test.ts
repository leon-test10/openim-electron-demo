import assert from "node:assert/strict";

import {
  AgentCollaborationEngine,
  InMemoryCollaborationStateStore,
  type CollaborationParticipant,
} from "../src/agent-core";

let now = 1000;
let id = 0;
const store = new InMemoryCollaborationStateStore();
const createEngine = () =>
  new AgentCollaborationEngine(store, {
    now: () => now++,
    createID: () => `id-${++id}`,
  });

const participants: CollaborationParticipant[] = [
  {
    participantID: "human-driver",
    kind: "human",
    principalID: "openim-user-1",
    displayName: "Human Driver",
    role: "driver",
  },
  {
    participantID: "worker-a",
    kind: "agent",
    principalID: "agent-worker-a",
    displayName: "Worker A",
    role: "worker",
    agentID: "gateway-worker-a",
  },
  {
    participantID: "worker-b",
    kind: "agent",
    principalID: "agent-worker-b",
    displayName: "Worker B",
    role: "worker",
    agentID: "gateway-worker-b",
  },
  {
    participantID: "reviewer",
    kind: "agent",
    principalID: "agent-reviewer",
    displayName: "Reviewer",
    role: "reviewer",
    agentID: "gateway-reviewer",
  },
  {
    participantID: "human-observer",
    kind: "human",
    principalID: "openim-user-2",
    displayName: "Human Observer",
    role: "observer",
  },
];

const run = async () => {
  const engine = createEngine();
  const subscribedEvents: string[] = [];
  const unsubscribe = engine.subscribe((event) => {
    subscribedEvents.push(event.eventID);
  });
  const created = await engine.createCollaboration({
    conversationID: "conversation-1",
    sessionID: "session-1",
    idempotencyKey: "message-1",
    objective: "Produce and review a release plan",
    participants,
  });
  const collaborationID = created.collaboration.collaborationID;
  assert.equal(created.created, true);
  await assert.rejects(
    () =>
      engine.createCollaboration({
        conversationID: "conversation-1",
        sessionID: "session-1",
        idempotencyKey: "invalid-role",
        objective: "must reject unknown roles from untrusted transports",
        participants: participants.map((participant) =>
          participant.participantID === "human-observer"
            ? { ...participant, role: "manager" as never }
            : participant,
        ),
      }),
    /Unsupported collaboration role/,
  );
  assert.equal(
    (
      await engine.createCollaboration({
        conversationID: "conversation-1",
        sessionID: "session-1",
        idempotencyKey: "message-1",
        objective: "must not replace original",
        participants,
      })
    ).created,
    false,
  );

  await assert.rejects(
    () =>
      engine.delegateTasks({
        collaborationID,
        driverParticipantID: "human-observer",
        delegationKey: "invalid-observer-delegation",
        tasks: [
          {
            title: "invalid",
            instruction: "invalid",
            assigneeParticipantID: "worker-a",
          },
        ],
      }),
    /must have role driver/,
  );

  const delegated = await engine.delegateTasks({
    collaborationID,
    driverParticipantID: "human-driver",
    delegationKey: "initial-work",
    tasks: [
      {
        taskID: "task-a",
        title: "Implementation plan",
        instruction: "Prepare the implementation plan",
        assigneeParticipantID: "worker-a",
      },
      {
        taskID: "task-b",
        title: "Risk analysis",
        instruction: "Prepare the risk analysis",
        assigneeParticipantID: "worker-b",
      },
    ],
  });
  assert.equal(delegated.tasks.length, 2);
  assert.deepEqual(
    engine.listReadyTasks(collaborationID).map((task) => task.taskID),
    ["task-a", "task-b"],
    "independent worker tasks are ready in parallel",
  );

  await engine.requestHumanIntervention({
    collaborationID,
    requestedByParticipantID: "worker-a",
    reason: "Production deployment requires approval",
    risk: "high",
    pendingAction: { action: "deploy" },
  });
  await assert.rejects(
    () =>
      engine.startTask({
        collaborationID,
        taskID: "task-a",
        assigneeParticipantID: "worker-a",
        runID: "run-a",
      }),
    /waiting for human/,
  );
  await assert.rejects(
    () =>
      engine.resolveHumanIntervention({
        collaborationID,
        humanParticipantID: "worker-a",
        decision: "approve",
      }),
    /Only a human/,
  );
  assert.equal(
    (
      await engine.resolveHumanIntervention({
        collaborationID,
        humanParticipantID: "human-driver",
        decision: "instruct",
        instruction: "Proceed only in staging",
      })
    ).status,
    "running",
  );

  await Promise.all([
    engine.startTask({
      collaborationID,
      taskID: "task-a",
      assigneeParticipantID: "worker-a",
      runID: "run-a",
    }),
    engine.startTask({
      collaborationID,
      taskID: "task-b",
      assigneeParticipantID: "worker-b",
      runID: "run-b",
    }),
  ]);
  await Promise.all([
    engine.completeTask({
      collaborationID,
      taskID: "task-a",
      assigneeParticipantID: "worker-a",
      output: { plan: "implementation" },
    }),
    engine.completeTask({
      collaborationID,
      taskID: "task-b",
      assigneeParticipantID: "worker-b",
      output: { risks: ["rollback"] },
    }),
  ]);

  const firstReview = await engine.beginReview({
    collaborationID,
    driverParticipantID: "human-driver",
  });
  await engine.startTask({
    collaborationID,
    taskID: firstReview.taskID,
    assigneeParticipantID: "reviewer",
    runID: "review-run-1",
  });
  const revision = await engine.submitReview({
    collaborationID,
    reviewTaskID: firstReview.taskID,
    reviewerParticipantID: "reviewer",
    decision: "revise",
    feedback: "Add rollback validation",
  });
  assert.equal(revision.status, "running");

  await engine.delegateTasks({
    collaborationID,
    driverParticipantID: "human-driver",
    delegationKey: "revision-1",
    tasks: [
      {
        taskID: "task-revision",
        title: "Rollback validation",
        instruction: "Validate rollback procedure",
        assigneeParticipantID: "worker-a",
      },
    ],
  });
  await engine.startTask({
    collaborationID,
    taskID: "task-revision",
    assigneeParticipantID: "worker-a",
    runID: "run-revision",
  });
  await engine.completeTask({
    collaborationID,
    taskID: "task-revision",
    assigneeParticipantID: "worker-a",
    output: { rollbackValidated: true },
  });

  const secondReview = await engine.beginReview({
    collaborationID,
    driverParticipantID: "human-driver",
  });
  assert.notEqual(secondReview.taskID, firstReview.taskID);
  await engine.startTask({
    collaborationID,
    taskID: secondReview.taskID,
    assigneeParticipantID: "reviewer",
    runID: "review-run-2",
  });
  const completed = await engine.submitReview({
    collaborationID,
    reviewTaskID: secondReview.taskID,
    reviewerParticipantID: "reviewer",
    decision: "approve",
    feedback: "Approved",
    finalSummary: "Release plan and rollback strategy verified",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.finalSummary, "Release plan and rollback strategy verified");

  const events = engine.listEvents(collaborationID);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index),
  );
  assert.equal(events.at(-1)?.type, "collaboration.completed");
  assert.deepEqual(
    subscribedEvents,
    events.map((event) => event.eventID),
    "committed collaboration events are emitted exactly once in sequence",
  );
  unsubscribe();

  const restored = createEngine();
  await restored.initialize();
  assert.equal(restored.getCollaboration(collaborationID)?.status, "completed");
  assert.equal(restored.listEvents(collaborationID).length, events.length);

  console.log("Agent collaboration orchestration contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
