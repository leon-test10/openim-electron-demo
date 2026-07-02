/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ensureOpencodeConfigFile,
} = require("../electron/main/opencodeConfigManage");

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "opencode-config-"));

(() => {
  const tempDir = makeTempDir();
  const templatePath = path.join(tempDir, "default-opencode.jsonc");
  const workspaceDir = path.join(tempDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(templatePath, "{\n  // internal llm\n  \"model\": \"local-llm/DeepSeek-V4-Flash\"\n}\n", "utf8");

  const first = ensureOpencodeConfigFile({
    targetDir: workspaceDir,
    defaultTemplatePath: templatePath,
    config: {
      enabled: true,
      mode: "create-if-missing",
      fileName: "opencode.jsonc",
    },
  });

  const targetPath = path.join(workspaceDir, "opencode.jsonc");
  assert.equal(first.written, true);
  assert.equal(first.path, targetPath);
  assert.match(fs.readFileSync(targetPath, "utf8"), /DeepSeek-V4-Flash/);

  fs.writeFileSync(targetPath, "{ \"model\": \"custom/model\" }\n", "utf8");
  const second = ensureOpencodeConfigFile({
    targetDir: workspaceDir,
    defaultTemplatePath: templatePath,
    config: {
      enabled: true,
      mode: "create-if-missing",
      fileName: "opencode.jsonc",
    },
  });
  assert.equal(second.written, false);
  assert.equal(fs.readFileSync(targetPath, "utf8"), "{ \"model\": \"custom/model\" }\n");

  const disabledDir = path.join(tempDir, "disabled-workspace");
  fs.mkdirSync(disabledDir, { recursive: true });
  const disabled = ensureOpencodeConfigFile({
    targetDir: disabledDir,
    defaultTemplatePath: templatePath,
    config: {
      enabled: false,
      mode: "create-if-missing",
      fileName: "opencode.jsonc",
    },
  });
  assert.equal(disabled.written, false);
  assert.equal(fs.existsSync(path.join(disabledDir, "opencode.jsonc")), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("opencodeConfigManage tests passed");
})();

export {};
