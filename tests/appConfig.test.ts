/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  DEFAULT_APP_CONFIG,
  mergeAppConfig,
  resolveConfiguredPath,
} = require("../electron/main/appConfig");

(() => {
  assert.equal(DEFAULT_APP_CONFIG.openim.serverHost, "10.96.253.9");
  assert.equal(DEFAULT_APP_CONFIG.openim.apiUrl, "http://10.96.253.9:10002");
  assert.equal(DEFAULT_APP_CONFIG.openim.wsUrl, "ws://10.96.253.9:10001");
  assert.equal(DEFAULT_APP_CONFIG.openim.chatUrl, "http://10.96.253.9:10008");
  assert.equal(DEFAULT_APP_CONFIG.llm.baseUrl, "http://10.96.248.17:8000/v1");
  assert.equal(DEFAULT_APP_CONFIG.opencode.command, "opencode");

  const merged = mergeAppConfig({
    openim: {
      serverHost: "10.1.2.3",
      apiUrl: "http://10.1.2.3:10002",
    },
    opencode: {
      command: "C:\\Tools\\opencode\\opencode.exe",
    },
  });

  assert.equal(merged.openim.serverHost, "10.1.2.3");
  assert.equal(merged.openim.apiUrl, "http://10.1.2.3:10002");
  assert.equal(merged.openim.wsUrl, DEFAULT_APP_CONFIG.openim.wsUrl);
  assert.equal(merged.openim.chatUrl, DEFAULT_APP_CONFIG.openim.chatUrl);
  assert.equal(merged.llm.baseUrl, DEFAULT_APP_CONFIG.llm.baseUrl);
  assert.equal(merged.opencode.command, "C:\\Tools\\opencode\\opencode.exe");

  const resolved = resolveConfiguredPath("%USERPROFILE%\\OpenIM-Agent\\workspaces", {
    USERPROFILE: "C:\\Users\\alice",
  });
  assert.equal(resolved, path.normalize("C:\\Users\\alice\\OpenIM-Agent\\workspaces"));

  console.log("appConfig tests passed");
})();

export {};
