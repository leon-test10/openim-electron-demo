import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import readline from "node:readline";

import {
  type AgentProtocolClient,
  type AgentProtocolEventFrame,
  type AgentProtocolFrame,
  type AgentProtocolMethod,
  type AgentProtocolRequestOptions,
  type AgentProtocolResponseFrame,
  OPENIM_AGENT_PROTOCOL_VERSION,
  parseAgentProtocolFrame,
} from "../agent-core";

export interface AgentStdioProtocolClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AgentStdioProtocolClient implements AgentProtocolClient {
  readonly endpoint: string;
  private readonly listeners = new Set<(event: AgentProtocolEventFrame) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private process?: ChildProcessWithoutNullStreams;

  constructor(private readonly options: AgentStdioProtocolClientOptions) {
    this.endpoint = `stdio://${options.command}`;
  }

  connect() {
    if (this.process && !this.process.killed) return Promise.resolve();
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;

    readline
      .createInterface({ input: child.stdout })
      .on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code, signal) => {
      this.process = undefined;
      this.failAll(
        new Error(
          `Agent stdio provider exited (code=${String(code)}, signal=${String(
            signal,
          )})`,
        ),
      );
    });
    return Promise.resolve();
  }

  async request(
    method: AgentProtocolMethod,
    params: Record<string, unknown>,
    options: AgentProtocolRequestOptions = {},
  ) {
    await this.connect();
    const child = this.process;
    if (!child) throw new Error("Agent stdio provider is unavailable");

    const id = crypto.randomUUID();
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 30000;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Agent stdio request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    child.stdin.write(
      `${JSON.stringify({
        protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: "req",
        id,
        method,
        params,
        idempotencyKey: options.idempotencyKey,
      })}\n`,
    );
    return result;
  }

  subscribe(listener: (event: AgentProtocolEventFrame) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    const child = this.process;
    this.process = undefined;
    if (child && !child.killed) child.kill();
    this.failAll(new Error("Agent stdio provider closed"));
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let frame: AgentProtocolFrame;
    try {
      frame = parseAgentProtocolFrame(JSON.parse(line));
    } catch {
      return;
    }
    if (frame.type === "event") {
      this.listeners.forEach((listener) => listener(frame as AgentProtocolEventFrame));
      return;
    }
    if (frame.type !== "res") return;
    this.settle(frame);
  }

  private settle(frame: AgentProtocolResponseFrame) {
    const request = this.pending.get(frame.id);
    if (!request) return;
    this.pending.delete(frame.id);
    clearTimeout(request.timer);
    if (frame.ok) {
      request.resolve(frame.payload ?? {});
    } else {
      request.reject(
        new Error(frame.error?.message ?? "Agent provider request failed"),
      );
    }
  }

  private failAll(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
