import assert from "node:assert/strict";

import { AgentGateway, InMemoryAgentGatewayStateStore } from "../src/agent-core";
import { AgentGatewayServer } from "../electron/main/agentGatewayServer";

const run = async () => {
  const gateway = new AgentGateway(new InMemoryAgentGatewayStateStore(), {
    createID: (() => {
      let value = 0;
      return () => `id-${++value}`;
    })(),
  });
  const server = new AgentGatewayServer(gateway, { authToken: "secret" });
  const { baseUrl } = await server.start();
  const request = (pathname: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
        ...init.headers,
      },
    });

  try {
    assert.equal((await fetch(`${baseUrl}/v1/agents`)).status, 401);
    assert.equal(
      (
        await request("/v1/agents/register", {
          method: "POST",
          body: JSON.stringify({
            agentID: "worker-1",
            runtimeID: "opencode",
            displayName: "Worker",
            endpoint: "stdio://worker",
            capabilities: ["run.execute", "run.streaming"],
          }),
        })
      ).status,
      200,
    );
    assert.equal((await (await request("/v1/agents")).json()).length, 1);

    const created = await (
      await request("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          conversationID: "conversation-1",
          sessionID: "session-1",
          targetAgentID: "worker-1",
          idempotencyKey: "message-1",
          input: { prompt: "hello" },
          actor: { type: "human", id: "user-1" },
        }),
      })
    ).json();
    assert.equal(created.created, true);

    const availableRuns = await (
      await request("/v1/agents/worker-1/runs?available=true")
    ).json();
    assert.equal(availableRuns[0].runID, created.run.runID);
    const claimed = await (
      await request(`/v1/runs/${created.run.runID}/claim`, {
        method: "POST",
        body: JSON.stringify({ agentID: "worker-1", leaseMs: 5000 }),
      })
    ).json();
    assert.equal(claimed.claimed, true);
    await request(`/v1/runs/${created.run.runID}/renew-claim`, {
      method: "POST",
      body: JSON.stringify({ agentID: "worker-1", leaseMs: 5000 }),
    });

    await request(`/v1/runs/${created.run.runID}/events`, {
      method: "POST",
      body: JSON.stringify({ eventID: "event-1", state: "running" }),
    });
    const events = await (
      await request(`/v1/runs/${created.run.runID}/events?after=-1`)
    ).json();
    assert.deepEqual(
      events.map((event) => event.sequence),
      [0, 1],
    );
    const metrics = await (await request("/v1/metrics")).json();
    assert.equal(metrics.runs.running, 1);
    assert.equal(metrics.audits.allow, 3);
    assert.deepEqual(metrics.sessions, { active: 1, closed: 0 });

    const authorization = await (
      await request("/v1/authorize", {
        method: "POST",
        body: JSON.stringify({
          action: "permission.reply",
          actorType: "agent",
          actorID: "worker-1",
          risk: "high",
        }),
      })
    ).json();
    assert.equal(authorization.decision, "require_human");
  } finally {
    await server.stop();
  }

  console.log("Agent Gateway HTTP server contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
