import crypto from "node:crypto";

import type { IMHistoryToolQuery } from "../../src/types/agentSession";

export interface HistoryCapability {
  sessionID: string;
  conversationID: string;
  token: string;
}

export class AgentHistoryCapabilityRegistry {
  private readonly byToken = new Map<string, HistoryCapability>();

  issue(
    sessionID: string,
    conversationID: string,
    token = crypto.randomBytes(32).toString("hex"),
  ) {
    this.revokeSession(sessionID);
    const capability = { sessionID, conversationID, token };
    this.byToken.set(token, capability);
    return capability;
  }

  resolve(token: string) {
    return this.byToken.get(token);
  }

  revokeSession(sessionID: string) {
    for (const [token, capability] of this.byToken) {
      if (capability.sessionID === sessionID) this.byToken.delete(token);
    }
  }

  clear() {
    this.byToken.clear();
  }
}

export const normalizeHistoryToolQuery = (
  value: Partial<IMHistoryToolQuery>,
): IMHistoryToolQuery => {
  const query: IMHistoryToolQuery = {
    mode: value.mode === "search" ? "search" : "recent",
    limit: Math.min(Math.max(Number(value.limit) || 20, 1), 100),
    beforeClientMsgID:
      typeof value.beforeClientMsgID === "string"
        ? value.beforeClientMsgID.slice(0, 128)
        : undefined,
    keyword:
      typeof value.keyword === "string" ? value.keyword.slice(0, 128) : undefined,
  };
  if (query.mode === "search" && !query.keyword?.trim()) {
    throw new Error("keyword is required for search mode");
  }
  return query;
};
