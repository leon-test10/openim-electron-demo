/**
 *  OpenCode 适配器
 *
 *  非交互模式：opencode run "prompt"
 *  - 通过 stdin 传入 prompt（避免 shell 命令行转义问题）
 *  - 自动处理 Windows 下 npm 全局路径的问题
 *
 *  安装：npm i -g opencode-ai
 *  测试：opencode run "say hello"
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 找到 opencode 可执行文件的实际路径
 */
function findOpenCodeExe(command) {
  if (fs.existsSync(command)) return command;
  try {
    const npmRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
    const candidates = [
      path.join(npmRoot, "opencode-ai", "bin", "opencode.exe"),
      path.join(npmRoot, "..", "opencode.exe"),
      path.join(npmRoot, "..", "opencode.cmd"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } catch {}
  return null;
}

module.exports = function createOpenCodeAdapter(config) {
  const command = findOpenCodeExe(config.command || "opencode");
  const finalCommand = command || config.command || "opencode";
  console.log(`[opencode] ${command ? "exe: " + command : "shell: " + finalCommand}`);

  return {
    async send(msg, prompt) {
      return new Promise((resolve, reject) => {
        // opencode run 通过 stdin 接收 prompt
        // 当 stdin 不是 TTY 时（pipe），opencode 自动从 stdin 读取
        const args = [...(config.args || ["run"])];

        const child = spawn(finalCommand, args, {
          cwd: config.workDir || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
          timeout: 300_000,
        });

        let stdout = "";
        let stderr = "";

        // 通过 stdin 写入 prompt 然后关闭（意为"没有更多输入了"）
        child.stdin.write(prompt);
        child.stdin.end();

        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));

        child.on("close", (code) => {
          if (code === 0 || stdout.length > 0) {
            console.log(`[opencode] 完成 (${stdout.length} chars, exit ${code})`);
            resolve(stdout);
          } else {
            console.error(`[opencode] 失败 (exit ${code})`);
            reject(new Error(stderr || `exit ${code}`));
          }
        });

        child.on("error", (err) =>
          reject(new Error(
            `opencode 未安装？请执行: ${config.install || "npm i -g opencode-ai"}\n错误: ${err.message}`
          ))
        );
      });
    },
  };
};
