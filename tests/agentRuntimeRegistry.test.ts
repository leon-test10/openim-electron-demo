import assert from "node:assert/strict";

import {
  AgentRuntimeRegistry,
  OPENIM_AGENT_PROTOCOL_VERSION,
  type AgentRuntimeAdapter,
  type AgentRuntimeCapability,
} from "../src/agent-core";

const createAdapter = (
  id: string,
  capabilities: AgentRuntimeCapability[] = ["session.create", "run.execute"],
): AgentRuntimeAdapter => ({
  descriptor: {
    id,
    displayName: `Runtime ${id}`,
    protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
    transport: "stdio",
    capabilities,
  },
  async ensureRuntime() {
    return { baseUrl: `stdio://${id}` };
  },
  async createSession() {
    return {
      runtimeSessionID: "runtime-session-1",
      status: "idle",
      messages: [],
      interactions: [],
    };
  },
  async restoreSession() {
    return undefined;
  },
  async listMessages() {
    return [];
  },
  async listModels() {
    return [];
  },
  async send() {},
  async abort() {},
  async replyPermission() {},
  async replyQuestion() {},
  subscribe() {
    return () => undefined;
  },
  stop() {},
});

const registry = new AgentRuntimeRegistry();
registry.register(createAdapter("z-runtime"));
registry.register(createAdapter("a-runtime", ["run.execute"]));

assert.deepEqual(
  registry.list().map((descriptor) => descriptor.id),
  ["a-runtime", "z-runtime"],
  "registry descriptors have a stable order",
);
assert.equal(registry.supports("z-runtime", "session.create"), true);
assert.equal(registry.supports("a-runtime", "session.create"), false);
assert.equal(registry.require("a-runtime").descriptor.transport, "stdio");
assert.throws(
  () => registry.register(createAdapter("a-runtime")),
  /already registered/,
);
assert.throws(() => registry.require("missing"), /not registered/);
assert.throws(
  () =>
    new AgentRuntimeRegistry().register(
      createAdapter("duplicate", ["run.execute", "run.execute"]),
    ),
  /duplicate capabilities/,
);

assert.equal(registry.unregister("a-runtime"), true);
assert.equal(registry.get("a-runtime"), undefined);

console.log("Agent runtime registry contract tests passed");
