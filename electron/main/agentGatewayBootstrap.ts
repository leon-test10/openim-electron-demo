import path from "node:path";

import { app } from "electron";

import { AgentGatewayWorker } from "../agent-core";
import { AgentCollaborationBridge } from "./agentCollaborationBridge";
import { agentGatewayManager } from "./agentGatewayManage";
import { getCurrentAppConfig } from "./appConfig";
import { OpenCodeGatewayRunExecutor } from "./opencodeGatewayRunExecutor";
import { OPEN_CODE_RUNTIME_DESCRIPTOR } from "./opencodeManage";

let collaborationBridge: AgentCollaborationBridge | undefined;
let localWorker: AgentGatewayWorker | undefined;

export const initializeAgentGateway = async () => {
  const config = getCurrentAppConfig().agent.gateway;
  const gatewayDirectory = path.join(
    app.getPath("userData"),
    "OpenIMData",
    "agent-gateway",
  );
  const status = await agentGatewayManager.initialize({
    stateFilePath: path.join(gatewayDirectory, "state.json"),
    collaborationStateFilePath: path.join(gatewayDirectory, "collaborations.json"),
    tokenFilePath: path.join(gatewayDirectory, "access.token"),
    heartbeatTtlMs: config.heartbeatTtlMs,
    server: {
      enabled: config.enabled,
      hostname: config.hostname,
      port: config.port,
      authToken: config.authToken,
    },
    localAgent: {
      agentID: "local-opencode",
      runtimeID: OPEN_CODE_RUNTIME_DESCRIPTOR.id,
      displayName: "Local OpenCode Agent",
      endpoint: "embedded://opencode",
      capabilities: [...OPEN_CODE_RUNTIME_DESCRIPTOR.capabilities],
    },
  });
  if (process.env.E2E_MODE === "1") return status;
  collaborationBridge ??= new AgentCollaborationBridge(
    agentGatewayManager.getCollaboration(),
  );
  void collaborationBridge.initialize().catch(() => undefined);
  localWorker ??= new AgentGatewayWorker(
    agentGatewayManager.getGateway(),
    new OpenCodeGatewayRunExecutor(),
    { agentID: "local-opencode" },
    agentGatewayManager.getCoordinator(),
  );
  localWorker.start();
  return status;
};

export const stopAgentCollaborationBridge = () => {
  localWorker?.stop();
  localWorker = undefined;
  collaborationBridge?.stop();
  collaborationBridge = undefined;
};
