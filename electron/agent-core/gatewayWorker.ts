import type { AgentCollaborationCoordinator } from "./collaborationCoordinator";
import type {
  GatewayRunEventRecord,
  GatewayRunRecord,
  GatewayRunStatus,
} from "./gateway";

export type GatewayWorkerExecutionState =
  | "running"
  | "waiting_permission"
  | "waiting_question";

export interface GatewayRunExecutor {
  execute(
    run: GatewayRunRecord,
    hooks: {
      onState(state: GatewayWorkerExecutionState): void | Promise<void>;
    },
  ): Promise<Record<string, unknown>>;
}

export interface AgentGatewayWorkerOptions {
  agentID: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  createEventID?: () => string;
}

export interface AgentGatewayWorkerTransport {
  listRuns(filter: {
    targetAgentID?: string;
    status?: GatewayRunStatus;
    availableOnly?: boolean;
  }): GatewayRunRecord[] | Promise<GatewayRunRecord[]>;
  claimRun(params: {
    runID: string;
    agentID: string;
    leaseMs?: number;
  }): Promise<{ claimed: boolean; run: GatewayRunRecord }>;
  renewRunClaim(params: {
    runID: string;
    agentID: string;
    leaseMs?: number;
  }): Promise<GatewayRunRecord>;
  appendRunEvent(params: {
    eventID: string;
    runID: string;
    state: GatewayRunEventRecord["state"];
    payload?: Record<string, unknown>;
    collaborationID?: string;
  }): Promise<unknown>;
}

export class AgentGatewayWorker {
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly createEventID: () => string;
  private pollTimer?: ReturnType<typeof setInterval>;
  private active = false;
  private stopped = false;

  constructor(
    private readonly gateway: AgentGatewayWorkerTransport,
    private readonly executor: GatewayRunExecutor,
    private readonly options: AgentGatewayWorkerOptions,
    private readonly coordinator?: AgentCollaborationCoordinator,
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.createEventID =
      options.createEventID ??
      (() =>
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  start() {
    if (this.pollTimer) return;
    this.stopped = false;
    this.pollTimer = setInterval(() => {
      void this.drainOnce().catch(() => undefined);
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
    void this.drainOnce().catch(() => undefined);
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  async drainOnce() {
    if (this.active || this.stopped) return false;
    const run = (
      await this.gateway.listRuns({
        targetAgentID: this.options.agentID,
        status: "queued",
        availableOnly: true,
      })
    )[0];
    if (!run) return false;
    const claim = await this.gateway.claimRun({
      runID: run.runID,
      agentID: this.options.agentID,
      leaseMs: this.leaseMs,
    });
    if (!claim.claimed) return false;
    this.active = true;
    try {
      await this.executeClaimed(claim.run);
    } finally {
      this.active = false;
    }
    return true;
  }

  private async executeClaimed(run: GatewayRunRecord) {
    const collaborationID =
      typeof run.input.collaborationID === "string"
        ? run.input.collaborationID
        : undefined;
    let stateQueue: Promise<unknown> = Promise.resolve();
    let lastState: GatewayWorkerExecutionState = "running";
    const publishState = (state: GatewayWorkerExecutionState) => {
      if (state === lastState) return stateQueue;
      lastState = state;
      stateQueue = stateQueue.then(async () => {
        await this.gateway.renewRunClaim({
          runID: run.runID,
          agentID: this.options.agentID,
          leaseMs: this.leaseMs,
        });
        await this.publishRunEvent(run, collaborationID, state);
      });
      return stateQueue;
    };
    const leaseTimer = setInterval(() => {
      void this.gateway
        .renewRunClaim({
          runID: run.runID,
          agentID: this.options.agentID,
          leaseMs: this.leaseMs,
        })
        .catch(() => undefined);
    }, Math.max(1000, Math.floor(this.leaseMs / 3)));
    leaseTimer.unref?.();
    try {
      const output = await this.executor.execute(run, { onState: publishState });
      await stateQueue;
      await this.publishRunEvent(run, collaborationID, "completed", output);
    } catch (error) {
      await stateQueue.catch(() => undefined);
      await this.publishRunEvent(run, collaborationID, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(leaseTimer);
    }
  }

  private publishRunEvent(
    run: GatewayRunRecord,
    collaborationID: string | undefined,
    state: GatewayRunStatus,
    payload?: Record<string, unknown>,
  ) {
    const params = {
      runID: run.runID,
      eventID: this.createEventID(),
      state,
      payload,
      collaborationID,
    };
    return collaborationID && this.coordinator
      ? this.coordinator.applyRunEvent({ ...params, collaborationID })
      : this.gateway.appendRunEvent(params);
  }
}
