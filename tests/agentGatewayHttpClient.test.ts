import assert from "node:assert/strict";

import {
  AgentGateway,
  AgentGatewayHttpClient,
  AgentGatewayWorker,
  InMemoryAgentGatewayStateStore,
} from "../src/agent-core";
import { AgentGatewayServer } from "../electron/main/agentGatewayServer";

const run = async () => {
  let nextID = 0;
  const store = new InMemoryAgentGatewayStateStore();
  const gateway = new AgentGateway(store, {
    createID: () => `gateway-${++nextID}`,
  });
  const server = new AgentGatewayServer(gateway, { authToken: "remote-secret" });
  const { baseUrl } = await server.start();
  const client = new AgentGatewayHttpClient(baseUrl, {
    authToken: "remote-secret",
    requestTimeoutMs: 5000,
  });

  try {
    const registration = await client.registerAgent({
      agentID: "remote-worker",
      runtimeID: "custom-runtime",
      displayName: "Remote worker",
      endpoint: "https://worker.example/agent",
      capabilities: ["session.create", "run.execute", "run.streaming"],
    });
    const workerClient = new AgentGatewayHttpClient(baseUrl, {
      agentID: "remote-worker",
      authToken: registration.accessToken,
      requestTimeoutMs: 5000,
    });
    assert.equal((await client.discoverAgents())[0]?.agentID, "remote-worker");
    assert.equal((await workerClient.heartbeat("remote-worker")).status, "online");
    await assert.rejects(
      () => workerClient.heartbeat("another-worker"),
      /agent credential does not match target/,
    );
    await assert.rejects(() => workerClient.getMetrics(), /admin credential required/);

    const session = await client.createSession({
      sessionID: "remote-session",
      conversationID: "openim-conversation",
      actor: { type: "human", id: "openim-user" },
      metadata: { openimOwnerID: "openim-user" },
    });
    assert.equal(session.created, true);
    assert.equal(
      (await client.getSession("remote-session"))?.metadata?.openimOwnerID,
      "openim-user",
    );
    assert.equal(await client.getSession("missing-session"), undefined);
    assert.equal(
      (await client.listSessions({ conversationID: "openim-conversation" })).length,
      1,
    );

    const created = await client.createRun({
      conversationID: "openim-conversation",
      sessionID: "remote-session",
      targetAgentID: "remote-worker",
      idempotencyKey: "remote-message-1",
      input: { prompt: "execute outside Electron" },
      actor: { type: "human", id: "openim-user" },
    });
    assert.equal(created.created, true);
    const available = await workerClient.listRuns({
      targetAgentID: "remote-worker",
      status: "queued",
      availableOnly: true,
    });
    assert.equal(available[0]?.runID, created.run.runID);

    const claim = await workerClient.claimRun({
      runID: created.run.runID,
      agentID: "remote-worker",
      leaseMs: 5000,
    });
    assert.equal(claim.claimed, true);
    assert.equal(
      (
        await workerClient.renewRunClaim({
          runID: created.run.runID,
          agentID: "remote-worker",
          leaseMs: 5000,
        })
      ).status,
      "running",
    );
    await workerClient.appendRunEvent({
      runID: created.run.runID,
      eventID: "remote-completed",
      state: "completed",
      payload: { summary: "remote result" },
    });
    assert.deepEqual(
      (await workerClient.listRunEvents(created.run.runID)).map((event) => event.state),
      ["running", "completed"],
    );
    assert.equal((await client.getMetrics()).runs.completed, 1);

    const workerRun = await client.createRun({
      conversationID: "openim-conversation",
      sessionID: "remote-session",
      targetAgentID: "remote-worker",
      idempotencyKey: "remote-worker-loop",
      input: { prompt: "execute through typed worker transport" },
      actor: { type: "human", id: "openim-user" },
    });
    const remoteWorker = new AgentGatewayWorker(
      workerClient,
      {
        async execute(runRecord) {
          return {
            summary: `executed ${String(runRecord.input.prompt)}`,
            transport: "agent-gateway-http",
          };
        },
      },
      {
        agentID: "remote-worker",
        leaseMs: 5000,
        createEventID: (() => {
          let value = 0;
          return () => `remote-worker-event-${++value}`;
        })(),
      },
    );
    assert.equal(await remoteWorker.drainOnce(), true);
    assert.equal(
      (
        await client.listRuns({
          targetAgentID: "remote-worker",
          status: "completed",
        })
      ).some((runRecord) => runRecord.runID === workerRun.run.runID),
      true,
    );

    const close = await client.closeSession({
      sessionID: "remote-session",
      actor: { type: "human", id: "openim-user" },
    });
    assert.equal(close.closed, true);
    assert.equal(
      (await client.listSessions({ status: "closed" }))[0]?.sessionID,
      "remote-session",
    );
    assert.equal(
      (await client.listAuditRecords({ conversationID: "openim-conversation" }))
        .length >= 3,
      true,
    );

    const rotated = await client.registerAgent({
      agentID: "remote-worker",
      runtimeID: "custom-runtime",
      displayName: "Remote worker",
      endpoint: "https://worker.example/agent",
      capabilities: ["session.create", "run.execute", "run.streaming"],
    });
    assert.notEqual(rotated.accessToken, registration.accessToken);
    await assert.rejects(() => workerClient.heartbeat("remote-worker"), /unauthorized/);
  } finally {
    await server.stop();
  }

  console.log("Remote Agent Gateway HTTP client contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
