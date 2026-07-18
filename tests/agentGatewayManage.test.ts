import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentGatewayWorker } from "../src/agent-core";
import { AgentGatewayManager } from "../electron/main/agentGatewayManage";

const run = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-gateway-manager-"),
  );
  const stateFilePath = path.join(directory, "state.json");
  const tokenFilePath = path.join(directory, "access.token");
  const manager = new AgentGatewayManager();
  const restoredManager = new AgentGatewayManager();

  try {
    const status = await manager.initialize({
      stateFilePath,
      collaborationStateFilePath: path.join(directory, "collaborations.json"),
      tokenFilePath,
      heartbeatTtlMs: 10000,
      server: {
        enabled: true,
        hostname: "127.0.0.1",
        port: 0,
      },
      localAgent: {
        agentID: "local-contract-agent",
        runtimeID: "contract-runtime",
        displayName: "Local Contract Agent",
        endpoint: "embedded://contract",
        capabilities: ["run.execute", "run.streaming"],
      },
    });

    assert.equal(status.initialized, true);
    assert.equal(status.enabled, true);
    assert.ok(status.baseUrl);
    const token = (await fs.promises.readFile(tokenFilePath, "utf8")).trim();
    assert.equal(token.length >= 32, true);
    const response = await fetch(`${status.baseUrl}/v1/agents`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].agentID, "local-contract-agent");
    assert.equal(manager.getMetrics().agents.online, 1);

    const request = (pathname: string, body?: Record<string, unknown>) =>
      fetch(`${status.baseUrl}${pathname}`, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const collaboration = await (
      await request("/v1/collaborations", {
        conversationID: "conversation-manager",
        sessionID: "session-manager",
        idempotencyKey: "trigger-manager",
        objective: "Run through the managed Gateway",
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
            principalID: "local-agent",
            displayName: "Worker",
            role: "worker",
            agentID: "local-contract-agent",
          },
        ],
      })
    ).json();
    const collaborationID = collaboration.collaboration.collaborationID;
    assert.equal(
      (
        await request(`/v1/collaborations/${collaborationID}/delegate`, {
          driverParticipantID: "driver",
          delegationKey: "managed-delegation",
          tasks: [
            {
              taskID: "managed-task",
              title: "Managed task",
              instruction: "Execute through the Gateway",
              assigneeParticipantID: "worker",
            },
          ],
        })
      ).status,
      200,
    );
    const dispatch = await (
      await request(`/v1/collaborations/${collaborationID}/dispatch`, {
        requestedByParticipantID: "driver",
      })
    ).json();
    assert.equal(dispatch.dispatched.length, 1);
    assert.equal(dispatch.dispatched[0].run.sessionID, "session-manager");

    await manager.stop();
    const persisted = JSON.parse(await fs.promises.readFile(stateFilePath, "utf8"));
    assert.equal(persisted.agents[0].status, "offline");
    assert.equal(
      JSON.parse(
        await fs.promises.readFile(path.join(directory, "collaborations.json"), "utf8"),
      ).sessions[0].conversationID,
      "conversation-manager",
    );

    await restoredManager.initialize({
      stateFilePath,
      collaborationStateFilePath: path.join(directory, "collaborations.json"),
      tokenFilePath,
      heartbeatTtlMs: 10000,
      server: {
        enabled: false,
        hostname: "127.0.0.1",
        port: 0,
      },
      localAgent: {
        agentID: "local-contract-agent",
        runtimeID: "contract-runtime",
        displayName: "Local Contract Agent",
        endpoint: "embedded://contract",
        capabilities: ["run.execute", "run.streaming"],
      },
    });
    assert.equal(
      restoredManager.getGateway().getSession("session-manager")?.conversationID,
      "conversation-manager",
    );
    assert.equal(
      restoredManager
        .getCollaboration()
        .getCollaboration(collaborationID)
        ?.tasks.find((task) => task.taskID === "managed-task")?.status,
      "running",
    );
    const worker = new AgentGatewayWorker(
      restoredManager.getGateway(),
      {
        async execute() {
          return { summary: "completed after restart" };
        },
      },
      { agentID: "local-contract-agent" },
      restoredManager.getCoordinator(),
    );
    assert.equal(await worker.drainOnce(), true);
    assert.equal(
      restoredManager
        .getCollaboration()
        .getCollaboration(collaborationID)
        ?.tasks.find((task) => task.taskID === "managed-task")?.status,
      "completed",
    );
  } finally {
    await manager.stop();
    await restoredManager.stop();
    await fs.promises.rm(directory, { recursive: true, force: true });
  }

  console.log("Agent Gateway lifecycle manager tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
