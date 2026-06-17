/**
 *  OpenHands 适配器 — Headless 模式
 *
 *  非交互模式：poetry run python -m openhands.core.main -t "task"
 *  - 直接通过命令行执行，不需要 Web UI
 *  - 需要配置模型和 API key
 *
 *  安装：
 *    cd openhands
 *    poetry install
 *
 *  认证：
 *    export LLM_API_KEY=sk-...
 *    export LLM_MODEL=openai/gpt-4o
 *    # 或使用 config.toml 配置
 *
 *  验证：
 *    cd openhands && poetry run python -m openhands.core.main -t "say hello"
 *
 *  OpenHands 仓库（可构建运行）：../openhands/
 */
const { spawn } = require("child_process");

module.exports = function createOpenHandsAdapter(config) {
  const command = config.command || "poetry";
  // args 中 -t 是固定的，prompt 在运行时拼接
  const baseArgs = config.args || ["run", "python", "-m", "openhands.core.main", "-t"];

  return {
    async send(msg, prompt) {
      return new Promise((resolve, reject) => {
        const args = [...baseArgs, prompt];
        const child = spawn(command, args, {
          cwd: config.workDir || "../openhands",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
          timeout: 300_000, // 5 分钟超时
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));

        child.on("close", (code) => {
          if (code === 0) {
            console.log(`[openhands] 完成`);
            resolve(stdout);
          } else {
            console.error(`[openhands] 失败 (exit ${code})`);
            reject(new Error(stderr || `exit ${code}`));
          }
        });

        child.on("error", (err) =>
          reject(new Error(`OpenHands 未就绪？请执行: ${config.install || "cd ../openhands && poetry install"}`))
        );
      });
    },
  };
};
