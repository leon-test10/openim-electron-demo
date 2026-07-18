import type { AgentProtocolEventFrame, AgentProtocolMethod } from "./protocol";

export interface AgentProtocolRequestOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface AgentProtocolClient {
  readonly endpoint: string;
  connect(): Promise<void>;
  request(
    method: AgentProtocolMethod,
    params: Record<string, unknown>,
    options?: AgentProtocolRequestOptions,
  ): Promise<Record<string, unknown>>;
  subscribe(listener: (event: AgentProtocolEventFrame) => void): () => void;
  close(): void;
}
