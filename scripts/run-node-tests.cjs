const { spawnSync } = require("node:child_process");

const tests = [
  "src/services/agentRunContract/AgentRunContractService.test.ts",
  "tests/folderShareDownload.test.ts",
  "tests/appConfig.test.ts",
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
