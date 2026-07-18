import type { AgentProtocolClient, AgentProtocolRequestOptions } from "./client";
import {
  type AgentProtocolEventFrame,
  type AgentProtocolMethod,
  OPENIM_AGENT_PROTOCOL_VERSION,
  parseAgentProtocolFrame,
} from "./protocol";

export interface AgentHttpProtocolClientOptions {
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  createRequestID?: () => string;
}

export class AgentHttpProtocolClient implements AgentProtocolClient {
  readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly createRequestID: () => string;
  private readonly listeners = new Set<(event: AgentProtocolEventFrame) => void>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private sequence = -1;

  constructor(baseUrl: string, options: AgentHttpProtocolClientOptions = {}) {
    this.endpoint = baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.createRequestID =
      options.createRequestID ??
      (() =>
        globalThis.crypto?.randomUUID?.() ??
        `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  connect() {
    this.closed = false;
    return Promise.resolve();
  }

  async request(
    method: AgentProtocolMethod,
    params: Record<string, unknown>,
    options: AgentProtocolRequestOptions = {},
  ) {
    const id = this.createRequestID();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.requestTimeoutMs,
    );
    try {
      const response = await this.fetcher(`${this.endpoint}/v1/requests`, {
        method: "POST",
        headers: { ...this.headers, "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "req",
          id,
          method,
          params,
          idempotencyKey: options.idempotencyKey,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Agent provider HTTP request failed: ${response.status}`);
      }
      return this.unwrapResponse(parseAgentProtocolFrame(await response.json()), id);
    } finally {
      clearTimeout(timer);
    }
  }

  subscribe(listener: (event: AgentProtocolEventFrame) => void) {
    this.listeners.add(listener);
    this.schedulePoll(0);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
      }
    };
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private unwrapResponse(
    frame: ReturnType<typeof parseAgentProtocolFrame>,
    requestID: string,
  ) {
    if (frame.type !== "res" || frame.id !== requestID) {
      throw new Error(`Agent provider returned an unmatched response for ${requestID}`);
    }
    if (!frame.ok) {
      throw new Error(frame.error?.message ?? "Agent provider request failed");
    }
    return frame.payload ?? {};
  }

  private schedulePoll(delay: number) {
    if (this.closed || this.listeners.size === 0 || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollEvents();
    }, delay);
  }

  private async pollEvents() {
    try {
      const response = await this.fetcher(
        `${this.endpoint}/v1/events?after=${this.sequence}`,
        { headers: this.headers },
      );
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!Array.isArray(value)) {
        throw new Error("Agent provider event response must be an array");
      }
      for (const item of value) {
        const frame = parseAgentProtocolFrame(item);
        if (frame.type !== "event" || frame.sequence <= this.sequence) continue;
        this.sequence = frame.sequence;
        this.listeners.forEach((listener) => listener(frame));
      }
    } catch {
      // A transient provider/network failure is retried by the next poll.
    } finally {
      this.schedulePoll(this.pollIntervalMs);
    }
  }
}
