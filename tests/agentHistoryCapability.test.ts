import assert from "node:assert/strict";

import {
  AgentHistoryCapabilityRegistry,
  normalizeHistoryToolQuery,
} from "../electron/main/agentHistoryCapability";

const registry = new AgentHistoryCapabilityRegistry();
const first = registry.issue("session-a", "conversation-a", "token-a");
assert.equal(registry.resolve("token-a"), first);
assert.equal(
  registry.resolve("missing"),
  undefined,
  "unknown capabilities are rejected",
);
assert.equal(
  first.conversationID,
  "conversation-a",
  "conversation binding is server-controlled",
);

registry.issue("session-b", "conversation-b", "token-b");
registry.revokeSession("session-a");
assert.equal(
  registry.resolve("token-a"),
  undefined,
  "revocation takes effect immediately",
);
assert.equal(registry.resolve("token-b")?.conversationID, "conversation-b");

const rotated = registry.issue("session-b", "conversation-b", "token-b-rotated");
assert.equal(
  registry.resolve("token-b"),
  undefined,
  "issuing a new startup token rotates the old one",
);
assert.equal(registry.resolve(rotated.token)?.sessionID, "session-b");

assert.deepEqual(normalizeHistoryToolQuery({ mode: "recent", limit: 1000 }), {
  mode: "recent",
  limit: 100,
  beforeClientMsgID: undefined,
  keyword: undefined,
});
assert.throws(
  () => normalizeHistoryToolQuery({ mode: "search", keyword: "  " }),
  /keyword is required/,
);

registry.clear();
assert.equal(registry.resolve(rotated.token), undefined);
console.log("Agent history capability tests passed");
