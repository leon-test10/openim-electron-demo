import assert from "node:assert/strict";
import path from "node:path";

import { AgentStdioProtocolClient } from "../electron/main/agentStdioProtocolClient";

const run = async () => {
  const client = new AgentStdioProtocolClient({
    command: process.execPath,
    args: [path.resolve(__dirname, "fixtures/stdioAgentProvider.cjs")],
    requestTimeoutMs: 3000,
  });

  const events: string[] = [];
  client.subscribe((event) => events.push(event.event));

  try {
    const payload = await client.request(
      "agent.status",
      { probe: true },
      { idempotencyKey: "probe-1" },
    );
    assert.deepEqual(payload, {
      echoedMethod: "agent.status",
      idempotencyKey: "probe-1",
    });
    assert.deepEqual(events, ["agent.presence"]);
    assert.match(client.endpoint, /^stdio:\/\//);
  } finally {
    client.close();
  }

  console.log("Agent stdio protocol client contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
