import assert from "node:assert/strict";

import { mergeAgentRuntimeMessages } from "../../../electron/main/agentMessageMerge";
import type { AgentMessage } from "../../types/agentSession";

const message = (
  id: string,
  role: AgentMessage["role"],
  text: string,
  createdAt: number,
): AgentMessage => ({
  id,
  role,
  createdAt,
  sessionID: "session",
  parts: [{ id: `${id}_part`, type: "text", text }],
});

const local = message("local_turn_1", "user", "hello", 1_000);
const runtime = message("msg_1", "user", "hello", 1_050);
assert.deepEqual(mergeAgentRuntimeMessages([local], [runtime]), [runtime]);

const pending = message("local_turn_2", "user", "still queued", 2_000);
assert.deepEqual(mergeAgentRuntimeMessages([pending], [runtime]), [runtime, pending]);

const repeatedLocal = message("local_turn_3", "user", "hello", 1_100);
const repeatedRuntime = message("msg_2", "user", "hello", 1_150);
assert.deepEqual(
  mergeAgentRuntimeMessages([local, repeatedLocal], [runtime, repeatedRuntime]),
  [runtime, repeatedRuntime],
);

console.log("Agent runtime message merge tests passed");
