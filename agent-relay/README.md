# Agent Relay — IM 消息到 Agent Runtime 的桥接层

```
IM 客户端 → messageExporter.ts → POST /message → Relay (:9090) → Adapter → Agent CLI
```

## 快速开始

### 1. 启动 Relay Server

```bash
cd agent-relay
node relay-server.js
```

输出：
```
═══════════════════════════════════════════
  IM → Agent Relay 已启动
  监听: http://127.0.0.1:9090/message
  状态: http://127.0.0.1:9090/status
  已加载 1 个适配器
═══════════════════════════════════════════
```

### 2. 启动 IM 前端

```bash
cd ..
npm run dev
```

浏览器打开 `http://localhost:5173`，登录后发送消息，终端会看到 relay 收到消息的日志。

## 配置 Agent

编辑 `config.json`，把你想要使用的 agent 的 `enabled` 改为 `true`：

### Codex CLI

```bash
# 安装
npm i -g @openai/codex

# config.json
"codex": { "enabled": true }
```

### Claude Code

```bash
# 安装
npm i -g @anthropic-ai/claude-code

# config.json — 两种模式可选：

# 模式 A（默认）：每条消息单独执行
"claude-code": { "enabled": true }

# 模式 B：消息写入文件，由 Claude Code 自行读取
"claude-code": {
  "enabled": true,
  "mode": "file-watch",
  "watchFile": "./claude-input.txt"
}
```

### OpenCode

```bash
npm i -g @opencode-ai/cli

# config.json
"opencode": { "enabled": true }
```

### OpenHands

```bash
# 先启动 OpenHands 容器
docker run -d -p 3000:3000 ghcr.io/all-hands-ai/openhands

# 在浏览器打开 http://localhost:3000 创建 conversation
# 把 conversation ID 填入 config.json
"openhands": {
  "enabled": true,
  "conversationId": "your-conversation-id"
}
```

### 通用管道模式（stdin-pipe）

不需要安装任何 agent，适合想自己写脚本处理消息的场景：

```json
"stdin-pipe": { "enabled": true }
```

消息会写入 `agent-relay/agent-input.log`，第二个终端可以：

```bash
tail -f agent-relay/agent-input.log | your-custom-script
```

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  messageExporter.ts (IM 客户端内)                        │
│  exportMessage(msg) → serialize → POST /message (9090)  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP JSON
                       ▼
┌─────────────────────────────────────────────────────────┐
│  relay-server.js (Node.js 独立进程)                       │
│                                                         │
│  1. 接收 JSON: {timestamp, sender, content, ...}        │
│  2. 维护最近 20 条上下文                                  │
│  3. 构建 prompt（含对话历史）                             │
│  4. 分发给所有 enabled 的 adapter                        │
└──────┬──────────┬───────────┬───────────┬───────────────┘
       │          │           │           │
   spawn()    spawn()    HTTP POST    fs.appendFile
       │          │           │           │
       ▼          ▼           ▼           ▼
   Codex CLI  OpenCode    OpenHands   stdin-pipe
```

## 添加新 Agent

在 `adapters/` 下新建文件，导出 `function(config) → { send(msg, prompt) }`：

```js
// adapters/my-agent.js
const { spawn } = require("child_process");

module.exports = function createMyAgentAdapter(config) {
  return {
    async send(msg, prompt) {
      // prompt: 包含完整对话上下文的文本
      // msg:    原始消息对象 { timestamp, sender, content, sessionType, groupID }
      const child = spawn("my-agent", [prompt], {
        cwd: config.workDir || ".",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // ... 处理输出
    },
  };
};
```

然后在 `config.json` 中注册：

```json
"my-agent": {
  "enabled": true,
  "command": "my-agent",
  "args": [],
  "workDir": ".",
  "description": "我的自定义 Agent"
}
```

## 消息格式

Relay 收发的 JSON：

```json
{
  "timestamp": "2026-06-13 14:30:15.123",
  "sender": "Alice",
  "content": "帮我把 utils/request.ts 的超时时间改成 30 秒",
  "sessionType": "single",
  "groupID": null,
  "contentType": 101
}
```
