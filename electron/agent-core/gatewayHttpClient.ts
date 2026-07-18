import type {
  AgentGatewayMetrics,
  GatewayActorType,
  GatewayAgentRecord,
  GatewayAuditRecord,
  GatewayAuthorizationRequest,
  GatewayRiskLevel,
  GatewayRunEventRecord,
  GatewayRunRecord,
  GatewayRunStatus,
  GatewaySessionRecord,
  GatewaySessionStatus,
} from "./gateway";
import type { AgentRuntimeCapability } from "./runtime";

export interface AgentGatewayHttpClientOptions {
  agentID?: string;
  authToken?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

type RunCreationResult = { created: boolean; run: GatewayRunRecord };
type SessionCreationResult = {
  created: boolean;
  session: GatewaySessionRecord;
};
type RunClaimResult = {
  claimed: boolean;
  run: GatewayRunRecord;
  event?: GatewayRunEventRecord;
};

/**
 * Typed client for agents and control-plane callers that live outside the
 * Electron process. It deliberately mirrors the durable Agent Gateway API so a
 * remote worker does not need to depend on Electron or OpenIM renderer code.
 */
export class AgentGatewayHttpClient {
  readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly agentID?: string;
  private readonly headers: Record<string, string>;
  private readonly requestTimeoutMs: number;

  constructor(baseUrl: string, options: AgentGatewayHttpClientOptions = {}) {
    this.endpoint = baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.agentID = options.agentID;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.headers = {
      ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}),
      ...options.headers,
    };
  }

  registerAgent(params: {
    agentID: string;
    runtimeID: string;
    displayName: string;
    endpoint: string;
    capabilities: AgentRuntimeCapability[];
    metadata?: Record<string, unknown>;
  }) {
    return this.request<GatewayAgentRecord & { accessToken: string }>(
      "/v1/agents/register",
      {
        method: "POST",
        body: params,
      },
    );
  }

  heartbeat(agentID: string) {
    return this.request<GatewayAgentRecord>(
      `/v1/agents/${encodeURIComponent(agentID)}/heartbeat`,
      { method: "POST", body: {} },
    );
  }

  discoverAgents(
    filter: {
      capability?: AgentRuntimeCapability;
      includeOffline?: boolean;
    } = {},
  ) {
    return this.request<GatewayAgentRecord[]>(
      this.withQuery("/v1/agents", {
        capability: filter.capability,
        includeOffline: filter.includeOffline,
      }),
    );
  }

  createSession(params: {
    sessionID: string;
    conversationID: string;
    actor: { type: GatewayActorType; id: string };
    metadata?: Record<string, unknown>;
  }) {
    return this.request<SessionCreationResult>("/v1/sessions", {
      method: "POST",
      body: params,
    });
  }

  getSession(sessionID: string) {
    return this.request<GatewaySessionRecord>(
      `/v1/sessions/${encodeURIComponent(sessionID)}`,
      {},
      true,
    );
  }

  listSessions(
    filter: {
      conversationID?: string;
      status?: GatewaySessionStatus;
    } = {},
  ) {
    return this.request<GatewaySessionRecord[]>(this.withQuery("/v1/sessions", filter));
  }

  closeSession(params: {
    sessionID: string;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
  }) {
    const { sessionID, ...body } = params;
    return this.request<{ closed: boolean; session: GatewaySessionRecord }>(
      `/v1/sessions/${encodeURIComponent(sessionID)}/close`,
      { method: "POST", body },
    );
  }

  createRun(params: {
    conversationID: string;
    sessionID: string;
    targetAgentID: string;
    idempotencyKey: string;
    input: Record<string, unknown>;
    maxAttempts?: number;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
  }) {
    return this.request<RunCreationResult>("/v1/runs", {
      method: "POST",
      body: params,
    });
  }

  listRuns(
    filter: {
      targetAgentID?: string;
      status?: GatewayRunStatus;
      availableOnly?: boolean;
    } = {},
  ) {
    const targetAgentID = filter.targetAgentID ?? this.agentID;
    const pathname = this.agentID
      ? `/v1/agents/${encodeURIComponent(this.agentID)}/runs`
      : "/v1/runs";
    if (this.agentID && targetAgentID !== this.agentID) {
      return Promise.reject(
        new Error("Agent-scoped client cannot list another agent's runs"),
      );
    }
    return this.request<GatewayRunRecord[]>(
      this.withQuery(pathname, {
        targetAgentID: this.agentID ? undefined : targetAgentID,
        status: filter.status,
        available: filter.availableOnly,
      }),
    );
  }

  claimRun(params: { runID: string; agentID: string; leaseMs?: number }) {
    const { runID, ...body } = params;
    return this.request<RunClaimResult>(`/v1/runs/${encodeURIComponent(runID)}/claim`, {
      method: "POST",
      body,
    });
  }

  renewRunClaim(params: { runID: string; agentID: string; leaseMs?: number }) {
    const { runID, ...body } = params;
    return this.request<GatewayRunRecord>(
      `/v1/runs/${encodeURIComponent(runID)}/renew-claim`,
      { method: "POST", body },
    );
  }

  retryRun(runID: string, options: { delayMs?: number; lastError?: string } = {}) {
    return this.request<{ scheduled: boolean; run: GatewayRunRecord }>(
      `/v1/runs/${encodeURIComponent(runID)}/retry`,
      { method: "POST", body: options },
    );
  }

  abortRun(params: {
    runID: string;
    actor: { type: GatewayActorType; id: string };
    risk?: GatewayRiskLevel;
    humanApproval?: { approverID: string; approvedAt: number };
    reason?: string;
  }) {
    const { runID, ...body } = params;
    return this.request<{
      aborted: boolean;
      run: GatewayRunRecord;
      event?: GatewayRunEventRecord;
    }>(`/v1/runs/${encodeURIComponent(runID)}/abort`, {
      method: "POST",
      body,
    });
  }

  appendRunEvent(params: {
    runID: string;
    eventID: string;
    state: GatewayRunEventRecord["state"];
    payload?: Record<string, unknown>;
    collaborationID?: string;
  }) {
    const { runID, ...body } = params;
    return this.request<{ appended: boolean; event: GatewayRunEventRecord }>(
      `/v1/runs/${encodeURIComponent(runID)}/events`,
      { method: "POST", body },
    );
  }

  listRunEvents(runID: string, afterSequence = -1) {
    return this.request<GatewayRunEventRecord[]>(
      this.withQuery(`/v1/runs/${encodeURIComponent(runID)}/events`, {
        after: afterSequence,
      }),
    );
  }

  authorizeAction(request: GatewayAuthorizationRequest) {
    return this.request<GatewayAuditRecord>("/v1/authorize", {
      method: "POST",
      body: { ...request },
    });
  }

  getMetrics() {
    return this.request<AgentGatewayMetrics>("/v1/metrics");
  }

  listAuditRecords(
    filter: {
      conversationID?: string;
      runID?: string;
    } = {},
  ) {
    return this.request<GatewayAuditRecord[]>(this.withQuery("/v1/audits", filter));
  }

  private withQuery(
    pathname: string,
    values: Record<string, string | number | boolean | undefined>,
  ) {
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    const suffix = query.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }

  private request<T>(
    pathname: string,
    options?: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    },
    allowNotFound?: false,
  ): Promise<T>;
  private request<T>(
    pathname: string,
    options: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    },
    allowNotFound: true,
  ): Promise<T | undefined>;
  private async request<T>(
    pathname: string,
    options: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    } = {},
    allowNotFound = false,
  ): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(`${this.endpoint}${pathname}`, {
        method: options.method ?? "GET",
        headers: {
          ...this.headers,
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      if (allowNotFound && response.status === 404) return undefined;
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Agent Gateway request failed: ${response.status}`;
        throw new Error(message);
      }
      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
