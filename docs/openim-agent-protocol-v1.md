# OpenIM Agent Protocol v1

## 1. 目标与边界

OpenIM Agent Protocol v1 是 OpenIM-Agent 与具体 Agent Runtime 之间的运行时无关契约。OpenCode 只是第一个正式 Adapter；任何实现该协议的本地进程或远程服务都可以注册为 Runtime，而不需要依赖 Electron、React 或 OpenIM SDK。

协议层负责：

- Session 创建、恢复和历史读取；
- Run 启动、流式事件和终止；
- 权限、问题和人工回复；
- 模型枚举与产物交付；
- 请求幂等键、事件 ID 和单调递增序列。

Agent Gateway 是协议之上的分布式调度与治理层，两者不要混用：

- **Provider Protocol**：OpenIM-Agent 主动调用一个 Runtime；
- **Gateway API**：分布式 Agent 注册、发现并领取持久 Run。

权威类型定义位于 `electron/agent-core/protocol/v1.ts`，运行时抽象位于 `electron/agent-core/runtime.ts`。

## 2. Frame

所有 Frame 都包含：

```ts
{
  protocolVersion: 1;
  timestamp: number;
}
```

### 2.1 Request

```json
{
  "protocolVersion": 1,
  "timestamp": 1784361600000,
  "type": "req",
  "id": "req-01",
  "method": "run.start",
  "idempotencyKey": "openim-message-id",
  "params": {
    "workspacePath": "C:\\workspace",
    "runtimeSessionID": "runtime-session-01",
    "messageID": "openim-message-id",
    "prompt": "检查并修复测试"
  }
}
```

支持的方法：

| 方法                                   | 用途                       |
| -------------------------------------- | -------------------------- |
| `agent.connect` / `agent.status`       | 连接和健康状态             |
| `session.create` / `session.restore`   | 创建或恢复 Runtime Session |
| `session.messages`                     | 获取 Runtime 历史          |
| `model.list`                           | 枚举模型                   |
| `run.start` / `run.abort`              | 执行或终止 Run             |
| `permission.reply` / `question.reply`  | 人工交互回复               |
| `artifact.publish` / `delivery.result` | 产物发布和交付结果         |

### 2.2 Response

成功：

```json
{
  "protocolVersion": 1,
  "timestamp": 1784361600001,
  "type": "res",
  "id": "req-01",
  "ok": true,
  "payload": {}
}
```

失败：

```json
{
  "protocolVersion": 1,
  "timestamp": 1784361600001,
  "type": "res",
  "id": "req-01",
  "ok": false,
  "error": {
    "code": "unavailable",
    "message": "runtime is restarting",
    "retryable": true,
    "retryAfterMs": 1000
  }
}
```

### 2.3 Event

```json
{
  "protocolVersion": 1,
  "timestamp": 1784361600100,
  "type": "event",
  "event": "run.event",
  "eventID": "event-01",
  "sequence": 12,
  "conversationID": "openim-conversation-id",
  "sessionID": "openim-agent-session-id",
  "runID": "run-id",
  "sourceAgentID": "worker-1",
  "sourceRuntimeID": "custom-runtime",
  "payload": {
    "state": "delta",
    "text": "正在检查"
  }
}
```

事件名称包括 `agent.presence`、`session.updated`、`run.event`、`permission.request`、`question.request`、`artifact.published` 和 `delivery.request`。

Run 状态包括 `queued`、`running`、`delta`、工具调用、等待权限/问题以及终态 `final`、`error`、`aborted`。

## 3. Capability 与 Registry

Runtime 必须声明 Descriptor：

```ts
const descriptor = {
  id: "my-runtime",
  displayName: "My Runtime",
  protocolVersion: 1,
  transport: "stdio",
  capabilities: [
    "session.create",
    "session.restore",
    "run.execute",
    "run.streaming",
    "interaction.permission",
  ],
} as const;
```

Registry 拒绝：

- 空 Runtime ID 或显示名称；
- 非 v1 协议；
- 重复 Capability；
- 重复 Runtime ID。

调用方应在执行前通过 `AgentRuntimeRegistry.supports()` 检查能力，不能根据 Runtime 名称推断功能。

## 4. Provider 接入

### 4.1 stdio Provider

stdio 使用一行一个 JSON Frame 的 NDJSON。Provider 从 stdin 读取 Request/Response，向 stdout 写回 Response 和 Event；stderr 可用于日志，但不得混入协议 Frame。

```ts
registerStdioAgentProvider(descriptor, {
  command: "my-agent-provider",
  args: ["--stdio"],
  cwd: "C:\\workspace",
});
```

客户端负责进程生命周期、请求超时、按 Request ID 匹配响应以及协议校验。

### 4.2 HTTP Provider

HTTP Provider 实现：

- `POST /v1/requests`：接收一个 Request Frame，返回对应 Response Frame；
- `GET /v1/events?after=<sequence>`：返回 Event Frame 数组。

```ts
registerHttpAgentProvider(descriptor, "https://agent-provider.example", {
  headers: { authorization: "Bearer provider-token" },
  pollIntervalMs: 500,
});
```

网络暂时中断时事件轮询自动重试；非法 Frame、协议版本或不匹配的 Response ID 会被拒绝。

## 5. Adapter 行为

`AgentProviderRuntimeAdapter` 将 Protocol 方法映射为统一的 `AgentRuntimeAdapter`：

- `createSession` → `session.create`
- `restoreSession` → `session.restore`
- `listMessages` → `session.messages`
- `listModels` → `model.list`
- `send` → `run.start`
- `abort` → `run.abort`
- 权限/问题回复 → 对应交互方法

OpenCode 使用相同接口注册为 `embedded-api` Runtime，因此上层 AgentSession 不再依赖 OpenCode 特有 API。

## 6. 契约不变量

1. `protocolVersion` 必须严格为 `1`。
2. Request ID 与 Response ID 必须匹配。
3. 产生副作用的请求应携带稳定 `idempotencyKey`。
4. Event 必须有全局稳定 `eventID`，同一事件流的 `sequence` 必须单调递增。
5. 消费端按 `eventID` 去重，按 `sequence` 恢复断线期间事件。
6. Run 到达终态后不得继续追加 Delta 或状态事件。
7. Provider 不得自行将权限请求解释为批准；回复必须来自 OpenIM-Agent 的治理路径。

## 7. 验证

运行：

```bash
npm test
npm run build
```

契约覆盖包括 Protocol Frame 校验、Registry/Capability、OpenCode/Provider Adapter、HTTP Provider、stdio Provider、幂等和事件序列。构建还会检查 Electron 主进程产物不存在指向 `src/agent-core` 的运行时相对引用。
