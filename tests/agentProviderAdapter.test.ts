import assert from "node:assert/strict";

import {
  AgentProviderRuntimeAdapter,
  OPENIM_AGENT_PROTOCOL_VERSION,
  type AgentProtocolClient,
  type AgentProtocolEventFrame,
  type AgentProtocolMethod,
  type AgentProtocolRequestOptions,
} from "../src/agent-core";

const calls: Array<{
  method: AgentProtocolMethod;
  params: Record<string, unknown>;
  options?: AgentProtocolRequestOptions;
}> = [];
let eventListener: ((event: AgentProtocolEventFrame) => void) | undefined;

const client: AgentProtocolClient = {
  endpoint: "memory://provider",
  async connect() {},
  async request(method, params, options) {
    calls.push({ method, params, options });
    if (method === "session.create") {
      return {
        runtimeSessionID: "provider-session-1",
        status: "idle",
        messages: [],
        interactions: [],
      };
    }
    if (method === "session.messages") return { messages: [] };
    if (method === "model.list") return { models: [] };
    return {};
  },
  subscribe(listener) {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  },
  close() {},
};

const adapter = new AgentProviderRuntimeAdapter(
  {
    id: "memory-provider",
    displayName: "Memory Provider",
    protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
    transport: "stdio",
    capabilities: ["session.create", "run.execute", "run.streaming"],
  },
  client,
);

const run = async () => {
  assert.deepEqual(await adapter.ensureRuntime(), {
    baseUrl: "memory://provider",
  });
  assert.equal(
    (await adapter.createSession({ workspacePath: "C:/work", title: "test" }))
      .runtimeSessionID,
    "provider-session-1",
  );

  await adapter.send({
    workspacePath: "C:/work",
    runtimeSessionID: "provider-session-1",
    prompt: "hello",
    messageID: "message-1",
  });
  assert.equal(calls.at(-1)?.method, "run.start");
  assert.equal(calls.at(-1)?.options?.idempotencyKey, "message-1");

  const runtimeEvents: Array<{ type: string; sequence?: unknown }> = [];
  adapter.subscribe((event) =>
    runtimeEvents.push({ type: event.type, sequence: event.payload.sequence }),
  );
  eventListener?.({
    protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
    timestamp: Date.now(),
    type: "event",
    event: "run.event",
    eventID: "event-1",
    sequence: 7,
    sessionID: "provider-session-1",
    payload: { state: "running" },
  });
  assert.deepEqual(runtimeEvents, [{ type: "run.event", sequence: 7 }]);

  console.log("Agent provider adapter contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
