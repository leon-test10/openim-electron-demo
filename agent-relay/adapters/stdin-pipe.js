/**
 *  stdin-pipe 适配器 — 通用管道模式
 *
 *  这是最简单的"万能"适配器，不依赖任何特定 agent。
 *  消息写入一个本地文件，agent 侧通过 tail -f 或类似方式读取。
 *
 *  使用方式：
 *    1. 在 config.json 中保持 "enabled": true（默认已开启）
 *    2. 在另一个终端：
 *       tail -f agent-relay/agent-input.log | your-agent-command
 *    3. 或者让 agent 以文件监听模式启动
 *
 *  输出格式：每条消息前有分隔线，agent 侧可以按 "--- MSG ---" 切割。
 */
const fs = require("fs");
const path = require("path");

module.exports = function createStdinPipeAdapter(config) {
  const pipePath = path.resolve(
    __dirname, "..",
    config.pipePath || "./agent-input.log"
  );

  // 启动时清空旧文件，写入头部
  fs.writeFileSync(
    pipePath,
    `# IM → Agent 输入管道\n# 启动时间: ${new Date().toISOString()}\n# 格式: JSON Lines，每条消息一行\n\n`,
    "utf-8"
  );

  console.log(`[stdin-pipe] 管道文件: ${pipePath}`);

  return {
    async send(msg, prompt) {
      // 每条消息写两行：一行结构化数据，一行人类可读
      const record = JSON.stringify({
        timestamp: msg.timestamp,
        sender: msg.sender,
        content: msg.content,
        sessionType: msg.sessionType,
        groupID: msg.groupID || null,
      });

      const humanLine = [
        `--- MSG ---`,
        `[${msg.timestamp}] ${msg.sender}: ${msg.content}`,
        "",
      ].join("\n");

      fs.appendFileSync(pipePath, record + "\n" + humanLine, "utf-8");

      // 同时输出到 stdout，方便调试
      console.log(`[stdin-pipe] ${msg.sender}: ${msg.content.substring(0, 80)}`);
    },
  };
};
