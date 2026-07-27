const { spawnSync } = require("node:child_process");

const tests = [
  "src/services/humanAgentCollaboration/HumanAgentCollaborationService.test.ts",
  "src/services/agentRunContract/AgentRunContractService.test.ts",
  "src/services/offlineIM/OfflineIMService.test.ts",
  "src/services/agentSessions/sessionModel.test.ts",
  "src/services/agentSessions/botCheckpoint.test.ts",
  "src/services/agentSessions/messageMerge.test.ts",
  "tests/folderShareDownload.test.ts",
  "tests/appConfig.test.ts",
  "tests/opencodeBundleManage.test.ts",
  "tests/opencodeConfigManage.test.ts",
  "tests/agentHistoryCapability.test.ts",
  "tests/agentProtocol.test.ts",
  "tests/agentRuntimeRegistry.test.ts",
  "tests/agentProviderAdapter.test.ts",
  "tests/agentProviderRegistration.test.ts",
  "tests/agentGateway.test.ts",
  "tests/agentGatewayFileStore.test.ts",
  "tests/agentGatewayServer.test.ts",
  "tests/agentGatewayHttpClient.test.ts",
  "tests/agentGatewayWorker.test.ts",
  "tests/agentGatewayManage.test.ts",
  "tests/agentCollaboration.test.ts",
  "tests/agentCollaborationCoordinator.test.ts",
  "tests/agentHttpProtocolClient.test.ts",
  "tests/agentStdioProtocolClient.test.ts",
  "tests/agentDelivery.test.ts",
  "tests/agentStreaming.test.ts",
  "tests/agentSessionRecovery.test.ts",
  "tests/opencodeHttp.test.ts",
];

const compilerOptions = JSON.stringify({
  module: "commonjs",
  esModuleInterop: true,
});

for (const testFile of tests) {
  const result = spawnSync(
    process.execPath,
    ["-r", "ts-node/register/transpile-only", testFile],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TS_NODE_COMPILER_OPTIONS: compilerOptions,
      },
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
