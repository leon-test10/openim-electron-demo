import assert from "node:assert/strict";

import { applyRuntimeMessageEvent } from "../electron/main/agentStreaming";
import type { AgentMessage } from "../src/types/agentSession";

const baseMessage: AgentMessage = {
  id: "assistant-stream",
  sessionID: "runtime-stream",
  role: "assistant",
  createdAt: 1,
  parts: [],
};

let messages = applyRuntimeMessageEvent([], {
  type: "message.updated",
  runtimeSessionID: "runtime-stream",
  payload: {},
  message: baseMessage,
});
messages = applyRuntimeMessageEvent(messages, {
  type: "message.part.updated",
  runtimeSessionID: "runtime-stream",
  payload: {},
  messageID: baseMessage.id,
  part: { id: "text-stream", type: "text" },
  delta: "Hello",
});
messages = applyRuntimeMessageEvent(messages, {
  type: "message.part.updated",
  runtimeSessionID: "runtime-stream",
  payload: {},
  messageID: baseMessage.id,
  part: { id: "text-stream", type: "text" },
  delta: " world",
});
assert.equal(messages[0].parts[0].text, "Hello world");

messages = applyRuntimeMessageEvent(messages, {
  type: "message.updated",
  runtimeSessionID: "runtime-stream",
  payload: {},
  message: { ...baseMessage, completedAt: 2 },
});
assert.equal(messages[0].completedAt, 2);
assert.equal(messages[0].parts[0].text, "Hello world");

console.log("Agent streaming message tests passed");
