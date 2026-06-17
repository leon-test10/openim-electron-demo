/**
 *  Claude Code 适配器 — 两种模式可选
 *
 *  模式 A（默认 — one-shot）：
 *    每收到一条消息，执行 claude --print "prompt"
 *    适用于 claude 的 CLI 模式
 *
 *  模式 B（file-watch — 适合持久会话）：
 *    消息写入一个 watched file，claude 侧通过 --input-file 或 tail -f 读取
 *    在 config.json 中加 "mode": "file-watch", "watchFile": "./claude-input.txt"
 *
 *  安装：npm i -g @anthropic-ai/claude-code
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

module.exports = function createClaudeCodeAdapter(config) {
  const mode = config.mode || "one-shot";

  // 模式 A：one-shot，每条消息独立执行
  if (mode === "one-shot") {
    return {
      async send(msg, prompt) {
        return new Promise((resolve, reject) => {
          const args = [...(config.args || ["--print"]), prompt];
          const child = spawn(config.command || "claude", args, {
            cwd: config.workDir || process.cwd(),
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, CL AUDE_CODE_USE_BEDROCK: "1" },
            timeout: 180_000,
          });

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));

          child.on("close", (code) => {
            if (code === 0) {
              console.log(`[claude-code] 执行完成`);
              resolve(stdout);
            } else {
              console.error(`[claude-code] exit ${code}`);
              reject(new Error(stderr || `exit ${code}`));
            }
          });

          child.on("error", (err) => reject(err));
        });
      },
    };
  }

  // 模式 B：file-watch，消息追加到文件，由 agent 侧自行读取
  const watchFile = path.resolve(config.watchFile || "./claude-input.txt");
  return {
    async send(msg, prompt) {
      // 每条消息用分隔线包裹，方便 agent 侧解析
      const chunk = [
        "--- MSG START ---",
        `时间: ${msg.timestamp}`,
        `发送者: ${msg.sender}`,
        `内容: ${msg.content}`,
        `--- PROMPT ---`,
        prompt,
        "--- MSG END ---\n",
      ].join("\n");

      fs.appendFileSync(watchFile, chunk, "utf-8");
      console.log(`[claude-code] 已写入 ${watchFile}`);
    },
  };
};
