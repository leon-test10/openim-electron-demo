import assert from "node:assert/strict";

import {
  OPENIM_AGENT_PROTOCOL_VERSION,
  isTerminalRunEventState,
  parseAgentProtocolFrame,
} from "../src/agent-core/protocol";

const request = {
  protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
  timestamp: 1,
  type: "req",
  id: "req-1",
  method: "run.start",
  params: { sessionID: "session-1" },
  idempotencyKey: "run-1",
};

assert.deepEqual(parseAgentProtocolFrame(request), request);

const event = {
  protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
  timestamp: 2,
  type: "event",
  event: "run.event",
  eventID: "event-1",
  sequence: 0,
  conversationID: "conversation-1",
  sessionID: "session-1",
  runID: "run-1",
  payload: { state: "running" },
};

assert.deepEqual(parseAgentProtocolFrame(event), event);
assert.equal(isTerminalRunEventState("final"), true);
assert.equal(isTerminalRunEventState("error"), true);
assert.equal(isTerminalRunEventState("aborted"), true);
assert.equal(isTerminalRunEventState("running"), false);

assert.throws(
  () => parseAgentProtocolFrame({ ...request, protocolVersion: 2 }),
  /Unsupported agent protocol version/,
);
assert.throws(
  () => parseAgentProtocolFrame({ ...request, method: "runtime.magic" }),
  /requires id and method/,
);
assert.throws(
  () => parseAgentProtocolFrame({ ...event, sequence: -1 }),
  /non-negative integer sequence/,
);
assert.throws(
  () =>
    parseAgentProtocolFrame({
      protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
      timestamp: 3,
      type: "res",
      id: "req-1",
      ok: false,
    }),
  /requires an error/,
);

console.log("Agent Protocol v1 contract tests passed");
