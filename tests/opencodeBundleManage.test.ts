/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

const {
  ensureBundledOpencodeCommand,
} = require("../electron/main/opencodeBundleManage");

(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-bundle-"));
  const archivePath = path.join(tempDir, "opencode-windows-x64.zip");
  const installDir = path.join(tempDir, "install");
  const zip = new AdmZip();
  zip.addFile("opencode.exe", Buffer.from("fake exe"));
  zip.writeZip(archivePath);

  const commandPath = ensureBundledOpencodeCommand({
    archivePath,
    installDir,
  });

  assert.equal(commandPath, path.join(installDir, "opencode.exe"));
  assert.equal(fs.readFileSync(commandPath, "utf8"), "fake exe");

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("opencodeBundleManage tests passed");
})();

export {};
