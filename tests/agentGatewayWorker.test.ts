import assert from "node:assert/strict";

import {
  AgentCollaborationCoordinator,
  AgentCollaborationEngine,
  AgentGateway,
  AgentGatewayWorker,
  InMemoryAgentGatewayStateStore,
  InMemoryCollaborationStateStore,
  type GatewayRunExecutor,
} from "../src/agent-core";

const run = async () => {
  let id = 0;
  const createID = () => `id-${++id}`;
  const gateway = new AgentGateway(new InMemoryAgentGatewayStateStore(), {
    createID,
  });
  const collaboration = new AgentCollaborationEngine(
    new InMemoryCollaborationStateStore(),
    { createID },
  );
  const coordinator = new AgentCollaborationCoordinator(gateway, collaboration);
  await gateway.registerAgent({
    agentID: "local-worker",
    runtimeID: "opencode",
    displayName: "Local worker",
    endpoint: "embedded://opencode",
    capabilities: ["run.execute"],
  });
  const created = await collaboration.createCollaboration({
    conversationID: "conversation-worker",
    sessionID: "session-worker",
    idempotencyKey: "worker-trigger",
    objective: "Execute a real claimed run",
    participants: [
      {
        participantID: "driver",
        kind: "human",
        principalID: "openim-user",
        displayName: "Driver",
        role: "driver",
      },
      {
        participantID: "worker",
        kind: "agent",
        principalID: "local-worker",
        displayName: "Worker",
        role: "worker",
        agentID: "local-worker",
      },
    ],
  });
  const collaborationID = created.collaboration.collaborationID;
  await collaboration.delegateTasks({
    collaborationID,
    driverParticipantID: "driver",
    delegationKey: "worker-delegation",
    tasks: [
      {
        taskID: "task-worker",
        title: "Execute",
        instruction: "Produce the result",
        assigneeParticipantID: "worker",
      },
    ],
  });
  const dispatched = await coordinator.dispatchReadyTasks({
    collaborationID,
    requestedByParticipantID: "driver",
  });
  const runID = dispatched.dispatched[0].run.runID;
  const executor: GatewayRunExecutor = {
    async execute(_run, hooks) {
      await hooks.onState("waiting_permission");
      await hooks.onState("running");
      return { text: "worker result", artifacts: [] };
    },
  };
  const worker = new AgentGatewayWorker(
    gateway,
    executor,
    {
      agentID: "local-worker",
      leaseMs: 5000,
      createEventID: createID,
    },
    coordinator,
  );

  assert.equal(await worker.drainOnce(), true);
  assert.equal(gateway.getRun(runID)?.status, "completed");
  assert.deepEqual(
    gateway.listRunEvents(runID).map((event) => event.state),
    ["running", "waiting_permission", "running", "completed"],
  );
  assert.deepEqual(collaboration.getCollaboration(collaborationID)?.tasks[0].output, {
    text: "worker result",
    artifacts: [],
  });
  assert.equal(await worker.drainOnce(), false);

  console.log("Agent Gateway claimed worker execution tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
