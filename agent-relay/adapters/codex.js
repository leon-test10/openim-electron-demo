/**
 *  Codex CLI 适配器
 *
 *  非交互模式：codex exec "prompt"
 *  - 支持 stdin 管道：prompt 是参数，context 走 stdin
 *  - --ephemeral：不保留 rollback 文件
 *  - --full-auto：允许编辑文件（CI 场景按需开启）
 *
 *  安装：npm i -g @openai/codex
 *  认证：export OPENAI_API_KEY=sk-...
 *  验证：codex exec --ephemeral "say hello"
 *
 *  Codex 仓库（仅参考源码，不用于构建）：../codex/
 */
const { spawn } = require("child_process");

module.exports = function createCodexAdapter(config) {
  return {
    async send(msg, prompt) {
      return new Promise((resolve, reject) => {
        // codex exec "prompt" — 非交互模式
        const args = [...(config.args || ["exec", "--ephemeral"]), prompt];
        const child = spawn(config.command || "codex", args, {
          cwd: config.workDir || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
          timeout: 180_000,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));

        child.on("close", (code) => {
          if (code === 0) {
            console.log(`[codex] 完成 (${stdout.length} chars)`);
            // stderr 包含进度信息，stdout 包含最终输出
            if (stderr) {
              process.stderr.write(`[codex progress]\n${stderr}\n`);
            }
            resolve(stdout);
          } else {
            console.error(`[codex] 失败 (exit ${code})`);
            reject(new Error(stderr || `exit ${code}`));
          }
        });

        child.on("error", (err) =>
          reject(new Error(`codex 未安装？请执行: ${config.install || "npm i -g @openai/codex"}`))
        );
      });
    },
  };
};
