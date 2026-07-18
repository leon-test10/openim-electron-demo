import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentGatewayFileStore } from "../electron/main/agentGatewayFileStore";

const run = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-gateway-store-"),
  );
  const filePath = path.join(directory, "gateway.json");
  const store = new AgentGatewayFileStore(filePath);

  try {
    assert.equal(await store.load(), undefined);
    await store.save({
      version: 1,
      agents: [],
      runs: [],
      events: [],
      audits: [],
    });
    assert.deepEqual(await store.load(), {
      version: 1,
      agents: [],
      runs: [],
      events: [],
      audits: [],
    });
    assert.equal(
      (await fs.promises.readdir(directory)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }

  console.log("Agent gateway file persistence contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
