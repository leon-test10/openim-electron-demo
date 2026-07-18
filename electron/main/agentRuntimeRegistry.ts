import type { AgentRuntimeID } from "../agent-core";
import { AgentRuntimeRegistry } from "../agent-core";
import { opencodeManager } from "./opencodeManage";

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeID = "opencode";

export const agentRuntimeRegistry = new AgentRuntimeRegistry();

agentRuntimeRegistry.register(opencodeManager.adapter);
