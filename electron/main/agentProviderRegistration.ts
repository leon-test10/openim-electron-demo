import {
  AgentHttpProtocolClient,
  type AgentHttpProtocolClientOptions,
  AgentProviderRuntimeAdapter,
  type AgentRuntimeDescriptor,
} from "../agent-core";
import { agentRuntimeRegistry } from "./agentRuntimeRegistry";
import {
  AgentStdioProtocolClient,
  type AgentStdioProtocolClientOptions,
} from "./agentStdioProtocolClient";

type ProviderDescriptor = Omit<AgentRuntimeDescriptor, "transport">;

export const registerStdioAgentProvider = (
  descriptor: ProviderDescriptor,
  options: AgentStdioProtocolClientOptions,
) =>
  agentRuntimeRegistry.register(
    new AgentProviderRuntimeAdapter(
      { ...descriptor, transport: "stdio" },
      new AgentStdioProtocolClient(options),
    ),
  );

export const registerHttpAgentProvider = (
  descriptor: ProviderDescriptor,
  baseUrl: string,
  options?: AgentHttpProtocolClientOptions,
) =>
  agentRuntimeRegistry.register(
    new AgentProviderRuntimeAdapter(
      { ...descriptor, transport: "http-provider" },
      new AgentHttpProtocolClient(baseUrl, options),
    ),
  );

export const unregisterAgentProvider = (runtimeID: string) => {
  const adapter = agentRuntimeRegistry.get(runtimeID);
  if (!adapter) return false;
  adapter.stop();
  return agentRuntimeRegistry.unregister(runtimeID);
};
