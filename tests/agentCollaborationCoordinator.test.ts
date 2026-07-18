import assert from "node:assert/strict";

import {
  AgentCollaborationCoordinator,
  AgentCollaborationEngine,
  AgentGateway,
  InMemoryAgentGatewayStateStore,
  InMemoryCollaborationStateStore,
  type CollaborationParticipant,
} from "../src/agent-core";

let id = 0;
const createID = () => `coordinator-${++id}`;

const participants: CollaborationParticipant[] = [
  {
    participantID: "driver",
    kind: "human",
    principalID: "openim-user-driver",
    displayName: "Driver",
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
    participantID: "human-worker",
    kind: "human",
    principalID: "openim-user-worker",
    displayName: "Human Worker",
    role: "worker",
  },
];

const run = async () => {
  const gateway = new AgentGateway(new InMemoryAgentGatewayStateStore(), {
    createID,
  });
  const collaboration = new AgentCollaborationEngine(
    new InMemoryCollaborationStateStore(),
    { createID },
  );
  await Promise.all([gateway.initialize(), collaboration.initialize()]);
  for (const agentID of ["gateway-worker-a", "gateway-worker-b", "gateway-reviewer"]) {
    await gateway.registerAgent({
      agentID,
      runtimeID: "contract-runtime",
      displayName: agentID,
      endpoint: `memory://${agentID}`,
      capabilities: ["run.execute", "run.streaming"],
    });
  }

  const created = await collaboration.createCollaboration({
    conversationID: "conversation-1",
    sessionID: "agent-session-1",
    idempotencyKey: "trigger-message-1",
    objective: "Implement and review two independent changes",
    participants,
  });
  const collaborationID = created.collaboration.collaborationID;
  await collaboration.delegateTasks({
    collaborationID,
    driverParticipantID: "driver",
    delegationKey: "parallel-work",
    tasks: [
      {
        taskID: "task-a",
        title: "Change A",
        instruction: "Implement A",
        assigneeParticipantID: "worker-a",
      },
      {
        taskID: "task-b",
        title: "Change B",
        instruction: "Implement B",
        assigneeParticipantID: "worker-b",
      },
      {
        taskID: "task-human",
        title: "Human context check",
        instruction: "Confirm the OpenIM business context",
        assigneeParticipantID: "human-worker",
      },
    ],
  });

  const coordinator = new AgentCollaborationCoordinator(gateway, collaboration);
  const dispatched = await coordinator.dispatchReadyTasks({
    collaborationID,
    requestedByParticipantID: "driver",
  });
  assert.equal(dispatched.dispatched.length, 2);
  assert.deepEqual(
    dispatched.manualTasks.map((task) => task.taskID),
    ["task-human"],
  );
  assert.deepEqual(dispatched.dispatched.map((item) => item.run.sessionID).sort(), [
    "agent-session-1",
    "agent-session-1",
  ]);
  await collaboration.startTask({
    collaborationID,
    taskID: "task-human",
    assigneeParticipantID: "human-worker",
  });
  await collaboration.completeTask({
    collaborationID,
    taskID: "task-human",
    assigneeParticipantID: "human-worker",
    output: { confirmation: "OpenIM context confirmed by a human participant" },
  });

  for (const [index, item] of dispatched.dispatched.entries()) {
    await gateway.claimRun({
      runID: item.run.runID,
      agentID: item.run.targetAgentID,
    });
    await coordinator.applyRunEvent({
      collaborationID,
      runID: item.run.runID,
      eventID: `completed-${index}`,
      state: "completed",
      payload: { result: `output-${index}` },
    });
  }
  const duplicate = await coordinator.applyRunEvent({
    collaborationID,
    runID: dispatched.dispatched[0].run.runID,
    eventID: "completed-0",
    state: "completed",
    payload: { result: "must not apply twice" },
  });
  assert.equal(duplicate.applied, false);

  const reviewTask = await collaboration.beginReview({
    collaborationID,
    driverParticipantID: "driver",
  });
  const reviewDispatch = await coordinator.dispatchReadyTasks({
    collaborationID,
    requestedByParticipantID: "driver",
  });
  assert.equal(reviewDispatch.dispatched.length, 1);
  await gateway.claimRun({
    runID: reviewDispatch.dispatched[0].run.runID,
    agentID: reviewDispatch.dispatched[0].run.targetAgentID,
  });
  const reviewResult = await coordinator.applyRunEvent({
    collaborationID,
    runID: reviewDispatch.dispatched[0].run.runID,
    eventID: "review-completed",
    state: "completed",
    payload: { decision: "approve", feedback: "verified" },
  });
  assert.equal(reviewResult.reviewPending?.task.taskID, reviewTask.taskID);
  assert.equal(
    (
      await collaboration.resolveHumanIntervention({
        collaborationID,
        humanParticipantID: "driver",
        decision: "instruct",
        instruction: "Add final evidence",
      })
    ).status,
    "running",
  );
  const revisionDispatch = await coordinator.dispatchReadyTasks({
    collaborationID,
    requestedByParticipantID: "driver",
  });
  assert.equal(revisionDispatch.dispatched.length, 1);
  await gateway.claimRun({
    runID: revisionDispatch.dispatched[0].run.runID,
    agentID: revisionDispatch.dispatched[0].run.targetAgentID,
  });
  await coordinator.applyRunEvent({
    collaborationID,
    runID: revisionDispatch.dispatched[0].run.runID,
    eventID: "revision-completed",
    state: "completed",
    payload: { result: "evidence added" },
  });
  await collaboration.beginReview({
    collaborationID,
    driverParticipantID: "driver",
  });
  const finalReviewDispatch = await coordinator.dispatchReadyTasks({
    collaborationID,
    requestedByParticipantID: "driver",
  });
  await gateway.claimRun({
    runID: finalReviewDispatch.dispatched[0].run.runID,
    agentID: finalReviewDispatch.dispatched[0].run.targetAgentID,
  });
  await coordinator.applyRunEvent({
    collaborationID,
    runID: finalReviewDispatch.dispatched[0].run.runID,
    eventID: "final-review-completed",
    state: "completed",
    payload: { text: "Both changes verified" },
  });
  assert.equal(
    (
      await collaboration.resolveHumanIntervention({
        collaborationID,
        humanParticipantID: "driver",
        decision: "approve",
        instruction: "Both changes verified",
      })
    ).status,
    "completed",
  );

  const risky = await collaboration.createCollaboration({
    conversationID: "conversation-1",
    sessionID: "agent-session-1",
    idempotencyKey: "trigger-message-risky",
    objective: "Perform a high-risk task",
    participants,
  });
  await collaboration.delegateTasks({
    collaborationID: risky.collaboration.collaborationID,
    driverParticipantID: "driver",
    delegationKey: "risky-work",
    tasks: [
      {
        taskID: "risky-task",
        title: "Production mutation",
        instruction: "Mutate production",
        assigneeParticipantID: "worker-a",
        risk: "high",
      },
    ],
  });
  await assert.rejects(
    () =>
      coordinator.dispatchReadyTasks({
        collaborationID: risky.collaboration.collaborationID,
        requestedByParticipantID: "driver",
      }),
    /require human approval/,
  );
  const riskyDispatch = await coordinator.dispatchReadyTasks({
    collaborationID: risky.collaboration.collaborationID,
    requestedByParticipantID: "driver",
    humanApproval: {
      approverID: "openim-user-driver",
      approvedAt: Date.now(),
    },
  });
  assert.equal(riskyDispatch.dispatched.length, 1);
  await gateway.appendRunEvent({
    runID: riskyDispatch.dispatched[0].run.runID,
    eventID: "recovered-terminal-failure",
    state: "failed",
    payload: { error: "worker lease exhausted" },
  });
  assert.equal(
    (await coordinator.reconcileRun(riskyDispatch.dispatched[0].run.runID)).reconciled,
    true,
  );
  assert.equal(
    collaboration.getCollaboration(risky.collaboration.collaborationID)?.status,
    "failed",
  );

  console.log("Agent collaboration/Gateway coordinator tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
