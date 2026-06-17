/**
 *  Relay Server — IM 消息到 Agent Runtime 的桥接层
 *
 *  职责：
 *    1. 接收 IM 客户端发来的 HTTP POST /message
 *    2. 根据配置把消息分发给已启用的 agent adapter
 *
 *  启动：node agent-relay/relay-server.js
 *  配置：编辑 agent-relay/config.json
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

// ─── 加载配置 ──────────────────────────────────

const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const PORT = config.port || 9090;

// ─── 加载适配器 ────────────────────────────────

const adapters = [];

for (const [name, agentConfig] of Object.entries(config.agents)) {
  if (!agentConfig.enabled) continue;

  try {
    const adapterPath = path.join(__dirname, "adapters", `${name}.js`);
    const createAdapter = require(adapterPath);
    const adapter = createAdapter(agentConfig);
    adapters.push({ name, adapter });
    console.log(`[relay] ✓ 已加载适配器: ${name} (${agentConfig.description})`);
  } catch (err) {
    console.warn(`[relay] ✗ 无法加载适配器 ${name}: ${err.message}`);
  }
}

if (adapters.length === 0) {
  console.warn("[relay] ⚠ 没有启用任何 agent，消息将被丢弃。请编辑 config.json。");
}

// ─── 上下文管理 ────────────────────────────────

/**
 * 保留最近的 N 条消息作为上下文，agent 可以看到完整对话
 */
const contextLimit = 20;
const contextBuffer = [];

function appendContext(msg) {
  contextBuffer.push(msg);
  while (contextBuffer.length > contextLimit) {
    contextBuffer.shift();
  }
}

function buildPrompt(msg) {
  // 给 agent 的 prompt：包含 IM 消息内容和对话上下文
  const context = contextBuffer.map((m, i) => {
    return `[${m.timestamp}] ${m.sender}: ${m.content}`;
  }).join("\n");

  return `你正在通过 IM 接收用户的消息。以下是最近的对话记录：

${context}

用户 ${msg.sender} 刚才说：${msg.content}

请根据上下文理解用户的意图并执行相应的操作。`
}

// ─── HTTP Server ──────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/message") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const msg = JSON.parse(body);
        appendContext(msg);

        console.log(`[relay] ← 收到消息: [${msg.sender}] ${msg.content.substring(0, 80)}`);

        // 分发给所有启用的 adapter
        const results = await Promise.allSettled(
          adapters.map(({ name, adapter }) =>
            adapter.send(msg, buildPrompt(msg)).then(() => {
              console.log(`[relay] → ${name}: 已投递`);
            })
          )
        );

        // 检查是否有失败的
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.error(`[relay] ${failures.length} 个 adapter 投递失败`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            dispatched: adapters.length - failures.length,
            adapters: adapters.map((a) => a.name),
          })
        );
      } catch (err) {
        console.error("[relay] 解析消息失败:", err.message);
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        running: true,
        adapters: adapters.map((a) => a.name),
        contextSize: contextBuffer.length,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  IM → Agent Relay 已启动`);
  console.log(`  监听: http://127.0.0.1:${PORT}/message`);
  console.log(`  状态: http://127.0.0.1:${PORT}/status`);
  console.log(`  已加载 ${adapters.length} 个适配器`);
  console.log(`═══════════════════════════════════════════\n`);
});
