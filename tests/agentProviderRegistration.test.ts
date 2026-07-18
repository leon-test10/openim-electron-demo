import assert from "node:assert/strict";

import { OPENIM_AGENT_PROTOCOL_VERSION } from "../src/agent-core";
import {
  registerHttpAgentProvider,
  unregisterAgentProvider,
} from "../electron/main/agentProviderRegistration";
import { agentRuntimeRegistry } from "../electron/main/agentRuntimeRegistry";

const runtimeID = "remote-contract-provider";
const adapter = registerHttpAgentProvider(
  {
    id: runtimeID,
    displayName: "Remote Contract Provider",
    protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
    capabilities: ["session.create", "run.execute", "run.streaming"],
  },
  "https://agent.example/",
  {
    headers: { authorization: "Bearer test-token" },
    createRequestID: () => "request-1",
  },
);

assert.equal(adapter.descriptor.transport, "http-provider");
assert.equal(agentRuntimeRegistry.require(runtimeID), adapter);
assert.equal(agentRuntimeRegistry.supports(runtimeID, "run.streaming"), true);
assert.equal(unregisterAgentProvider(runtimeID), true);
assert.equal(agentRuntimeRegistry.get(runtimeID), undefined);

console.log("Agent provider registration contract tests passed");
