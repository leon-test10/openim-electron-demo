import crypto from "node:crypto";
import http from "node:http";

import type {
  AgentCollaborationCoordinator,
  AgentCollaborationEngine,
  AgentGateway,
  AgentRuntimeCapability,
  GatewayActorType,
  GatewayRiskLevel,
  GatewayRunEventRecord,
  GatewayRunStatus,
  GatewaySessionStatus,
} from "../agent-core";

export interface AgentGatewayServerOptions {
  authToken: string;
  hostname?: string;
  port?: number;
  maxRequestBytes?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sendJSON = (response: http.ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

type GatewayPrincipal = { type: "admin" } | { type: "agent"; agentID: string };

class GatewayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class AgentGatewayServer {
  private server?: http.Server;

  constructor(
    private readonly gateway: AgentGateway,
    private readonly options: AgentGatewayServerOptions,
    private readonly collaboration?: AgentCollaborationEngine,
    private readonly coordinator?: AgentCollaborationCoordinator,
  ) {
    if (!options.authToken) throw new Error("Agent Gateway authToken is required");
  }

  async start() {
    if (this.server) return this.address();
    await this.gateway.initialize();
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(
        this.options.port ?? 0,
        this.options.hostname ?? "127.0.0.1",
        () => resolve(),
      );
    });
    return this.address();
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private address() {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("Agent Gateway is not listening");
    }
    return {
      hostname: address.address,
      port: address.port,
      baseUrl: `http://${address.address}:${address.port}`,
    };
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    try {
      const principal = this.authenticate(request);
      if (!principal) {
        sendJSON(response, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://agent-gateway.local");
      const method = request.method ?? "GET";

      if (method === "POST" && url.pathname === "/v1/agents/register") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        const credentialID = crypto.randomBytes(16).toString("base64url");
        const agent = await this.gateway.registerAgent({
          agentID: String(body.agentID ?? ""),
          credentialID,
          runtimeID: String(body.runtimeID ?? ""),
          displayName: String(body.displayName ?? ""),
          endpoint: String(body.endpoint ?? ""),
          capabilities: (body.capabilities ?? []) as AgentRuntimeCapability[],
          metadata: isRecord(body.metadata) ? body.metadata : undefined,
        });
        sendJSON(response, 200, {
          ...agent,
          accessToken: this.issueAgentToken(agent.agentID, credentialID),
        });
        return;
      }

      const heartbeat = url.pathname.match(/^\/v1\/agents\/([^/]+)\/heartbeat$/);
      if (method === "POST" && heartbeat) {
        const agentID = decodeURIComponent(heartbeat[1]);
        this.requireAgentOrAdmin(principal, agentID);
        sendJSON(response, 200, await this.gateway.heartbeat(agentID));
        return;
      }

      if (method === "GET" && url.pathname === "/v1/agents") {
        sendJSON(
          response,
          200,
          this.gateway.discoverAgents({
            capability:
              (url.searchParams.get("capability") as AgentRuntimeCapability) ||
              undefined,
            includeOffline: url.searchParams.get("includeOffline") === "true",
          }),
        );
        return;
      }

      if (method === "POST" && url.pathname === "/v1/sessions") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        const actor = isRecord(body.actor) ? body.actor : {};
        sendJSON(
          response,
          200,
          await this.gateway.createSession({
            sessionID: String(body.sessionID ?? ""),
            conversationID: String(body.conversationID ?? ""),
            actor: {
              type: String(actor.type ?? "") as GatewayActorType,
              id: String(actor.id ?? ""),
            },
            metadata: isRecord(body.metadata) ? body.metadata : undefined,
          }),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/v1/sessions") {
        this.requireAdmin(principal);
        sendJSON(
          response,
          200,
          this.gateway.listSessions({
            conversationID: url.searchParams.get("conversationID") ?? undefined,
            status:
              (url.searchParams.get("status") as GatewaySessionStatus) || undefined,
          }),
        );
        return;
      }

      const sessionRoute = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)(?:\/(close))?$/,
      );
      if (sessionRoute && method === "GET" && !sessionRoute[2]) {
        this.requireAdmin(principal);
        const session = this.gateway.getSession(decodeURIComponent(sessionRoute[1]));
        sendJSON(response, session ? 200 : 404, session ?? { error: "not_found" });
        return;
      }
      if (sessionRoute && method === "POST" && sessionRoute[2] === "close") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        const actor = isRecord(body.actor) ? body.actor : {};
        sendJSON(
          response,
          200,
          await this.gateway.closeSession({
            sessionID: decodeURIComponent(sessionRoute[1]),
            actor: {
              type: String(actor.type ?? "") as GatewayActorType,
              id: String(actor.id ?? ""),
            },
            risk:
              typeof body.risk === "string"
                ? (body.risk as GatewayRiskLevel)
                : undefined,
            humanApproval: isRecord(body.humanApproval)
              ? {
                  approverID: String(body.humanApproval.approverID ?? ""),
                  approvedAt: Number(body.humanApproval.approvedAt),
                }
              : undefined,
          }),
        );
        return;
      }

      const agentRuns = url.pathname.match(/^\/v1\/agents\/([^/]+)\/runs$/);
      if (method === "GET" && agentRuns) {
        const agentID = decodeURIComponent(agentRuns[1]);
        this.requireAgentOrAdmin(principal, agentID);
        sendJSON(
          response,
          200,
          this.gateway.listRuns({
            targetAgentID: agentID,
            status: (url.searchParams.get("status") as GatewayRunStatus) || undefined,
            availableOnly: url.searchParams.get("available") === "true",
          }),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/v1/runs") {
        this.requireAdmin(principal);
        sendJSON(
          response,
          200,
          this.gateway.listRuns({
            targetAgentID: url.searchParams.get("targetAgentID") ?? undefined,
            status: (url.searchParams.get("status") as GatewayRunStatus) || undefined,
            availableOnly: url.searchParams.get("available") === "true",
          }),
        );
        return;
      }

      if (method === "POST" && url.pathname === "/v1/runs") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        const actor = isRecord(body.actor) ? body.actor : {};
        sendJSON(
          response,
          200,
          await this.gateway.createRun({
            conversationID: String(body.conversationID ?? ""),
            sessionID: String(body.sessionID ?? ""),
            targetAgentID: String(body.targetAgentID ?? ""),
            idempotencyKey: String(body.idempotencyKey ?? ""),
            input: isRecord(body.input) ? body.input : {},
            maxAttempts:
              typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
            actor: {
              type: String(actor.type ?? "") as GatewayActorType,
              id: String(actor.id ?? ""),
            },
            risk:
              typeof body.risk === "string"
                ? (body.risk as GatewayRiskLevel)
                : undefined,
            humanApproval: isRecord(body.humanApproval)
              ? {
                  approverID: String(body.humanApproval.approverID ?? ""),
                  approvedAt: Number(body.humanApproval.approvedAt),
                }
              : undefined,
          }),
        );
        return;
      }

      const runClaim = url.pathname.match(/^\/v1\/runs\/([^/]+)\/(claim|renew-claim)$/);
      if (method === "POST" && runClaim) {
        const body = await this.readBody(request);
        const agentID = String(body.agentID ?? "");
        this.requireAgentOrAdmin(principal, agentID);
        const params = {
          runID: decodeURIComponent(runClaim[1]),
          agentID,
          leaseMs: typeof body.leaseMs === "number" ? body.leaseMs : undefined,
        };
        sendJSON(
          response,
          200,
          runClaim[2] === "claim"
            ? await this.gateway.claimRun(params)
            : await this.gateway.renewRunClaim(params),
        );
        return;
      }

      const runControl = url.pathname.match(/^\/v1\/runs\/([^/]+)\/(retry|abort)$/);
      if (method === "POST" && runControl) {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        if (runControl[2] === "retry") {
          sendJSON(
            response,
            200,
            await this.gateway.retryRun(runControl[1], {
              delayMs: typeof body.delayMs === "number" ? body.delayMs : undefined,
              lastError:
                typeof body.lastError === "string" ? body.lastError : undefined,
            }),
          );
          return;
        }
        const actor = isRecord(body.actor) ? body.actor : {};
        sendJSON(
          response,
          200,
          await this.gateway.abortRun({
            runID: runControl[1],
            actor: {
              type: String(actor.type ?? "") as GatewayActorType,
              id: String(actor.id ?? ""),
            },
            risk:
              typeof body.risk === "string"
                ? (body.risk as GatewayRiskLevel)
                : undefined,
            humanApproval: isRecord(body.humanApproval)
              ? {
                  approverID: String(body.humanApproval.approverID ?? ""),
                  approvedAt: Number(body.humanApproval.approvedAt),
                }
              : undefined,
            reason: typeof body.reason === "string" ? body.reason : undefined,
          }),
        );
        return;
      }

      if (method === "POST" && url.pathname === "/v1/collaborations") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        sendJSON(
          response,
          200,
          await this.requireCollaboration().createCollaboration(
            body as unknown as Parameters<
              AgentCollaborationEngine["createCollaboration"]
            >[0],
          ),
        );
        return;
      }

      const conversationCollaborations = url.pathname.match(
        /^\/v1\/conversations\/([^/]+)\/collaborations$/,
      );
      if (method === "GET" && conversationCollaborations) {
        this.requireAdmin(principal);
        sendJSON(
          response,
          200,
          this.requireCollaboration().listByConversation(
            decodeURIComponent(conversationCollaborations[1]),
          ),
        );
        return;
      }

      const collaborationRoute = url.pathname.match(/^\/v1\/collaborations\/([^/]+)$/);
      if (method === "GET" && collaborationRoute) {
        this.requireAdmin(principal);
        const value = this.requireCollaboration().getCollaboration(
          collaborationRoute[1],
        );
        sendJSON(response, value ? 200 : 404, value ?? { error: "not_found" });
        return;
      }

      const collaborationAction = url.pathname.match(
        /^\/v1\/collaborations\/([^/]+)\/(delegate|dispatch|review|review-result|human-request|human-resolve|events)$/,
      );
      if (collaborationAction) {
        this.requireAdmin(principal);
        const collaborationID = collaborationAction[1];
        const action = collaborationAction[2];
        if (method === "GET" && action === "events") {
          sendJSON(
            response,
            200,
            this.requireCollaboration().listEvents(
              collaborationID,
              Number(url.searchParams.get("after") ?? -1),
            ),
          );
          return;
        }
        if (method === "POST") {
          const body = await this.readBody(request);
          if (action === "delegate") {
            sendJSON(
              response,
              200,
              await this.requireCollaboration().delegateTasks({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationEngine["delegateTasks"]>[0]),
            );
            return;
          }
          if (action === "dispatch") {
            sendJSON(
              response,
              200,
              await this.requireCoordinator().dispatchReadyTasks({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationCoordinator["dispatchReadyTasks"]>[0]),
            );
            return;
          }
          if (action === "review") {
            sendJSON(
              response,
              200,
              await this.requireCollaboration().beginReview({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationEngine["beginReview"]>[0]),
            );
            return;
          }
          if (action === "review-result") {
            sendJSON(
              response,
              200,
              await this.requireCollaboration().submitReview({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationEngine["submitReview"]>[0]),
            );
            return;
          }
          if (action === "human-request") {
            sendJSON(
              response,
              200,
              await this.requireCollaboration().requestHumanIntervention({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationEngine["requestHumanIntervention"]>[0]),
            );
            return;
          }
          if (action === "human-resolve") {
            sendJSON(
              response,
              200,
              await this.requireCollaboration().resolveHumanIntervention({
                ...body,
                collaborationID,
              } as unknown as Parameters<AgentCollaborationEngine["resolveHumanIntervention"]>[0]),
            );
            return;
          }
        }
      }

      const runEvents = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
      if (runEvents && method === "POST") {
        const runID = decodeURIComponent(runEvents[1]);
        this.requireRunAgentOrAdmin(principal, runID);
        const body = await this.readBody(request);
        if (typeof body.collaborationID === "string" && this.coordinator) {
          sendJSON(
            response,
            200,
            await this.coordinator.applyRunEvent({
              collaborationID: body.collaborationID,
              runID,
              eventID: String(body.eventID ?? ""),
              state: String(body.state ?? "") as GatewayRunEventRecord["state"],
              payload: isRecord(body.payload) ? body.payload : undefined,
            }),
          );
          return;
        }
        sendJSON(
          response,
          200,
          await this.gateway.appendRunEvent({
            runID,
            eventID: String(body.eventID ?? ""),
            state: String(body.state ?? "") as GatewayRunEventRecord["state"],
            payload: isRecord(body.payload) ? body.payload : undefined,
          }),
        );
        return;
      }
      if (runEvents && method === "GET") {
        const runID = decodeURIComponent(runEvents[1]);
        this.requireRunAgentOrAdmin(principal, runID);
        sendJSON(
          response,
          200,
          this.gateway.listRunEvents(
            runID,
            Number(url.searchParams.get("after") ?? -1),
          ),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/v1/metrics") {
        this.requireAdmin(principal);
        sendJSON(response, 200, this.gateway.getMetrics());
        return;
      }
      if (method === "POST" && url.pathname === "/v1/authorize") {
        this.requireAdmin(principal);
        const body = await this.readBody(request);
        const approval = isRecord(body.humanApproval) ? body.humanApproval : undefined;
        sendJSON(
          response,
          200,
          await this.gateway.authorizeAction({
            action: String(body.action ?? "") as Parameters<
              AgentGateway["authorizeAction"]
            >[0]["action"],
            actorType: String(body.actorType ?? "") as GatewayActorType,
            actorID: String(body.actorID ?? ""),
            risk: String(body.risk ?? "") as GatewayRiskLevel,
            conversationID:
              typeof body.conversationID === "string" ? body.conversationID : undefined,
            sessionID: typeof body.sessionID === "string" ? body.sessionID : undefined,
            runID: typeof body.runID === "string" ? body.runID : undefined,
            humanApproval: approval
              ? {
                  approverID: String(approval.approverID ?? ""),
                  approvedAt: Number(approval.approvedAt),
                }
              : undefined,
            metadata: isRecord(body.metadata) ? body.metadata : undefined,
          }),
        );
        return;
      }
      if (method === "GET" && url.pathname === "/v1/audits") {
        this.requireAdmin(principal);
        sendJSON(
          response,
          200,
          this.gateway.listAuditRecords({
            conversationID: url.searchParams.get("conversationID") ?? undefined,
            runID: url.searchParams.get("runID") ?? undefined,
          }),
        );
        return;
      }

      sendJSON(response, 404, { error: "not_found" });
    } catch (error) {
      sendJSON(response, error instanceof GatewayHttpError ? error.status : 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private authenticate(request: http.IncomingMessage): GatewayPrincipal | undefined {
    const authorization = request.headers.authorization ?? "";
    const expected = Buffer.from(`Bearer ${this.options.authToken}`);
    const actual = Buffer.from(authorization);
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      return { type: "admin" };
    }
    if (!authorization.startsWith("Bearer agent-v1.")) return undefined;
    const token = authorization.slice("Bearer ".length);
    const [version, encodedPayload, signature] = token.split(".");
    if (version !== "agent-v1" || !encodedPayload || !signature) return undefined;
    const expectedSignature = crypto
      .createHmac("sha256", this.options.authToken)
      .update(`${version}.${encodedPayload}`)
      .digest("base64url");
    const expectedBuffer = Buffer.from(expectedSignature);
    const actualBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return undefined;
    }
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      );
      if (
        !isRecord(payload) ||
        typeof payload.agentID !== "string" ||
        typeof payload.credentialID !== "string"
      ) {
        return undefined;
      }
      const agent = this.gateway.getAgent(payload.agentID);
      if (!agent || agent.credentialID !== payload.credentialID) return undefined;
      return { type: "agent", agentID: payload.agentID };
    } catch {
      return undefined;
    }
  }

  private issueAgentToken(agentID: string, credentialID: string) {
    const version = "agent-v1";
    const payload = Buffer.from(
      JSON.stringify({ agentID, credentialID }),
      "utf8",
    ).toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.options.authToken)
      .update(`${version}.${payload}`)
      .digest("base64url");
    return `${version}.${payload}.${signature}`;
  }

  private requireAdmin(principal: GatewayPrincipal) {
    if (principal.type !== "admin") {
      throw new GatewayHttpError(403, "admin credential required");
    }
  }

  private requireAgentOrAdmin(principal: GatewayPrincipal, agentID: string) {
    if (principal.type === "agent" && principal.agentID !== agentID) {
      throw new GatewayHttpError(403, "agent credential does not match target");
    }
  }

  private requireRunAgentOrAdmin(principal: GatewayPrincipal, runID: string) {
    if (principal.type === "admin") return;
    const run = this.gateway.getRun(runID);
    if (!run) throw new GatewayHttpError(404, "run not found");
    this.requireAgentOrAdmin(principal, run.targetAgentID);
  }

  private requireCollaboration() {
    if (!this.collaboration) {
      throw new Error("Agent collaboration service is unavailable");
    }
    return this.collaboration;
  }

  private requireCoordinator() {
    if (!this.coordinator) {
      throw new Error("Agent collaboration coordinator is unavailable");
    }
    return this.coordinator;
  }

  private readBody(request: http.IncomingMessage) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const limit = this.options.maxRequestBytes ?? 1024 * 1024;
      request.on("data", (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += buffer.length;
        if (size > limit) {
          reject(new Error("Agent Gateway request is too large"));
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });
      request.once("error", reject);
      request.once("end", () => {
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!isRecord(value)) {
            throw new Error("Agent Gateway body must be an object");
          }
          resolve(value);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
