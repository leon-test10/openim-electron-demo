import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AgentCollaborationCoordinator,
  AgentCollaborationEngine,
  AgentGateway,
  type AgentGatewayMetrics,
  type GatewayAgentRecord,
  type GatewayAuditRecord,
} from "../agent-core";
import { AgentCollaborationFileStore } from "./agentCollaborationFileStore";
import { AgentGatewayFileStore } from "./agentGatewayFileStore";
import {
  AgentGatewayServer,
  type AgentGatewayServerOptions,
} from "./agentGatewayServer";

export interface ManagedLocalAgent {
  agentID: string;
  runtimeID: string;
  displayName: string;
  endpoint: string;
  capabilities: GatewayAgentRecord["capabilities"];
}

export interface AgentGatewayManagerOptions {
  stateFilePath: string;
  collaborationStateFilePath: string;
  tokenFilePath: string;
  heartbeatTtlMs?: number;
  server: Omit<AgentGatewayServerOptions, "authToken"> & {
    enabled: boolean;
    authToken?: string;
  };
  localAgent: ManagedLocalAgent;
}

export interface AgentGatewayManagerStatus {
  initialized: boolean;
  enabled: boolean;
  baseUrl?: string;
  tokenFilePath?: string;
  localAgentID?: string;
}

export class AgentGatewayManager {
  private gateway?: AgentGateway;
  private collaboration?: AgentCollaborationEngine;
  private coordinator?: AgentCollaborationCoordinator;
  private server?: AgentGatewayServer;
  private heartbeatTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private initialization?: Promise<AgentGatewayManagerStatus>;
  private status: AgentGatewayManagerStatus = {
    initialized: false,
    enabled: false,
  };

  initialize(options: AgentGatewayManagerOptions) {
    this.initialization ??= this.start(options);
    return this.initialization;
  }

  getStatus() {
    return { ...this.status };
  }

  discoverAgents(
    filter?: Parameters<AgentGateway["discoverAgents"]>[0],
  ): GatewayAgentRecord[] {
    return this.requireGateway().discoverAgents(filter);
  }

  getMetrics(): AgentGatewayMetrics {
    return this.requireGateway().getMetrics();
  }

  listAudits(
    filter?: Parameters<AgentGateway["listAuditRecords"]>[0],
  ): GatewayAuditRecord[] {
    return this.requireGateway().listAuditRecords(filter);
  }

  getGateway() {
    return this.requireGateway();
  }

  getCollaboration() {
    if (!this.collaboration) {
      throw new Error("Agent collaboration engine is not initialized");
    }
    return this.collaboration;
  }

  getCoordinator() {
    if (!this.coordinator) {
      throw new Error("Agent collaboration coordinator is not initialized");
    }
    return this.coordinator;
  }

  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.heartbeatTimer = undefined;
    this.sweepTimer = undefined;
    const gateway = this.gateway;
    const localAgentID = this.status.localAgentID;
    if (gateway && localAgentID) {
      await gateway.setAgentOffline(localAgentID);
    }
    await this.server?.stop();
    this.server = undefined;
    this.gateway = undefined;
    this.collaboration = undefined;
    this.coordinator = undefined;
    this.initialization = undefined;
    this.status = { initialized: false, enabled: false };
  }

  private async start(options: AgentGatewayManagerOptions) {
    const ttl = options.heartbeatTtlMs ?? 30000;
    const gateway = new AgentGateway(new AgentGatewayFileStore(options.stateFilePath), {
      heartbeatTtlMs: ttl,
    });
    const collaboration = new AgentCollaborationEngine(
      new AgentCollaborationFileStore(options.collaborationStateFilePath),
    );
    this.gateway = gateway;
    this.collaboration = collaboration;
    this.coordinator = new AgentCollaborationCoordinator(gateway, collaboration);
    await Promise.all([gateway.initialize(), collaboration.initialize()]);
    await gateway.registerAgent(options.localAgent);

    let baseUrl: string | undefined;
    let tokenFilePath: string | undefined;
    if (options.server.enabled) {
      const authToken =
        options.server.authToken?.trim() ||
        (await this.loadOrCreateToken(options.tokenFilePath));
      const server = new AgentGatewayServer(
        gateway,
        {
          authToken,
          hostname: options.server.hostname,
          port: options.server.port,
          maxRequestBytes: options.server.maxRequestBytes,
        },
        collaboration,
        this.coordinator,
      );
      this.server = server;
      baseUrl = (await server.start()).baseUrl;
      tokenFilePath = options.tokenFilePath;
    }

    this.heartbeatTimer = setInterval(() => {
      void gateway.heartbeat(options.localAgent.agentID).catch(() => undefined);
    }, Math.max(1000, Math.floor(ttl / 3)));
    this.heartbeatTimer.unref?.();
    this.sweepTimer = setInterval(() => {
      void Promise.all([
        gateway.sweepExpiredAgents(),
        gateway.recoverExpiredRunClaims(),
      ])
        .then(([, recovered]) =>
          Promise.all(
            recovered
              .filter((run) => run.status === "failed")
              .map((run) => this.coordinator?.reconcileRun(run.runID)),
          ),
        )
        .catch(() => undefined);
    }, Math.max(1000, Math.floor(ttl / 2)));
    this.sweepTimer.unref?.();

    this.status = {
      initialized: true,
      enabled: options.server.enabled,
      baseUrl,
      tokenFilePath,
      localAgentID: options.localAgent.agentID,
    };
    return this.getStatus();
  }

  private async loadOrCreateToken(tokenFilePath: string) {
    try {
      const token = (await fs.promises.readFile(tokenFilePath, "utf8")).trim();
      if (token) return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await fs.promises.mkdir(path.dirname(tokenFilePath), { recursive: true });
    await fs.promises.writeFile(tokenFilePath, `${token}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return token;
  }

  private requireGateway() {
    if (!this.gateway) throw new Error("Agent Gateway is not initialized");
    return this.gateway;
  }
}

export const agentGatewayManager = new AgentGatewayManager();
