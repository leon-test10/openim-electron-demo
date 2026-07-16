import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  discoverExternalAgentSessions,
  discoverManagedAgentSessions,
} from "../electron/main/agentSessionRecovery";

const run = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "openim-agent-recovery-"),
  );
  try {
    const id = "agent_session_recovered";
    const workspacePath = path.join(root, id);
    const metadataDir = path.join(workspacePath, ".openim-agent");
    await fs.promises.mkdir(metadataDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(metadataDir, "session.json"),
      JSON.stringify({
        version: 1,
        id,
        conversationID: "conversation-1",
        kind: "bot",
        title: "Bot Requests",
        runtime: "opencode",
        runtimeSessionID: "runtime-1",
        workspacePath,
        updatedAt: 200,
      }),
    );
    await fs.promises.writeFile(
      path.join(metadataDir, "messages.json"),
      JSON.stringify([
        {
          id: "message-1",
          sessionID: "runtime-1",
          role: "assistant",
          createdAt: 100,
          parts: [{ id: "text-1", type: "text", text: "restored" }],
        },
      ]),
    );

    const recovered = await discoverManagedAgentSessions(root, new Set());
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].id, id);
    assert.equal(recovered[0].kind, "bot");
    assert.equal(recovered[0].messages[0].parts[0].text, "restored");
    assert.equal(recovered[0].autoReplyTextEnabled, false);
    assert.equal(recovered[0].status, "disconnected");

    assert.deepEqual(
      await discoverManagedAgentSessions(root, new Set([id])),
      [],
    );
    const external = await discoverExternalAgentSessions([root], new Set());
    assert.equal(external.length, 1);
    assert.equal(external[0].id, id);
    assert.equal(external[0].managedWorkspace, false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

void run()
  .then(() => console.log("Agent session recovery tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
