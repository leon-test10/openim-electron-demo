/**
 * 消息导出工具 —— 发送到 Agent Relay Server
 *
 *   ┌──────────┐  JSON POST  ┌──────────────┐  spawn/stdin  ┌──────────────┐
 *   │  IM 客户端  │ ─────────→ │  Relay :9090  │ ────────────→ │  Agent CLI    │
 *   └──────────┘             └──────────────┘               └──────────────┘
 *
 *   useGlobalEvents → exportMessage(msg) → POST /message → Relay → adapter → Agent
 *
 * 第二阶段：如果想切换 writer（比如直接发 WebSocket），用 setWriter()
 */

import { MessageItem, MessageType, SessionType } from "@openim/wasm-client-sdk";
import dayjs from "dayjs";

// ─── 消息序列化 ────────────────────────────────

interface RelayMessage {
  timestamp: string;
  sender: string;
  content: string;
  sessionType: string;
  groupID: string | null;
  contentType: number;
}

function serializeMessage(msg: MessageItem): RelayMessage {
  let content = "";

  if (msg.contentType === MessageType.TextMessage && msg.textElem) {
    content = msg.textElem.content;
  } else if (msg.contentType === MessageType.PictureMessage) {
    content = "[图片消息]";
  } else if (msg.contentType === MessageType.FileMessage) {
    content = "[文件消息]";
  } else if (msg.contentType === MessageType.CustomMessage && msg.customElem) {
    try {
      const custom = JSON.parse(msg.customElem.data);
      content = `[自定义消息] ${JSON.stringify(custom)}`;
    } catch {
      content = "[自定义消息]";
    }
  } else {
    content = `[消息类型 ${msg.contentType}]`;
  }

  return {
    timestamp: dayjs(msg.sendTime).format("YYYY-MM-DD HH:mm:ss.SSS"),
    sender: msg.senderNickname || msg.sendID,
    content,
    sessionType:
      msg.sessionType === SessionType.Group
        ? "group"
        : msg.sessionType === SessionType.Notification
          ? "notification"
          : "single",
    groupID: msg.groupID || null,
    contentType: msg.contentType,
  };
}

// ─── Writer 接口 ───────────────────────────────

interface MessageWriter {
  write(data: RelayMessage): Promise<void>;
}

// ─── Relay Writer（默认） ──────────────────────

const RELAY_URL = "http://127.0.0.1:9090/message";

function createRelayWriter(): MessageWriter {
  return {
    async write(data: RelayMessage) {
      try {
        await fetch(RELAY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch {
        // relay 未启动，静默丢弃 — 不影响 IM 主流程
      }
    },
  };
}

// ─── 备用：Console Writer ──────────────────────

function createConsoleWriter(): MessageWriter {
  return {
    async write(data: RelayMessage) {
      console.log(
        `[messageExporter] [${data.timestamp}] [${data.sessionType}] ${data.sender}: ${data.content}`
      );
    },
  };
}

// ─── Writer 注册 ──────────────────────────────

let writer: MessageWriter | null = null;

function getWriter(): MessageWriter {
  if (!writer) {
    writer = createRelayWriter();
  }
  return writer;
}

/**
 * 替换 writer — 从"发 HTTP 给 relay"切换为其他投递方式
 *
 * 示例：直接发 WebSocket 给 agent
 *   setWriter({
 *     async write(data) {
 *       ws.send(JSON.stringify({ type: "im-message", ...data }));
 *     }
 *   });
 */
export function setWriter(newWriter: MessageWriter): void {
  writer = newWriter;
}

// ─── 公共入口 ─────────────────────────────────

/**
 * 唯一入口 — 从 useGlobalEvents 调用
 *
 * @param msg SDK 推送的原始消息对象
 */
export async function exportMessage(msg: MessageItem): void {
  try {
    const data = serializeMessage(msg);
    await getWriter().write(data);
  } catch {
    // 导出失败不中断主流程
  }
}
