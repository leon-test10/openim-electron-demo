import { parseOpenCodeSessionMessages } from "./parseOpenCodeSessionMessages";

const requestJSON = async (url: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    window.clearTimeout(timeout);
  }
};

export class OpenCodeServerClient {
  constructor(private readonly baseUrl: string) {}

  private url(pathname: string) {
    return `${this.baseUrl.replace(/\/+$/, "")}${pathname}`;
  }

  async health(): Promise<boolean> {
    for (const pathname of ["/health", "/api/health", "/"]) {
      try {
        await requestJSON(this.url(pathname));
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async listSessions(): Promise<unknown[]> {
    for (const pathname of ["/sessions", "/session", "/api/sessions"]) {
      try {
        const response = await requestJSON(this.url(pathname));
        if (Array.isArray(response)) return [...response] as unknown[];
        if (response && typeof response === "object") {
          const record = response as Record<string, unknown>;
          if (Array.isArray(record.sessions)) return [...record.sessions] as unknown[];
          if (Array.isArray(record.data)) return [...record.data] as unknown[];
          if (Array.isArray(record.items)) return [...record.items] as unknown[];
        }
      } catch {
        continue;
      }
    }

    throw new Error("OpenCode sessions API unavailable");
  }

  async getSessionMessages(sessionID: string): Promise<Record<string, unknown>[]> {
    const encodedSessionID = encodeURIComponent(sessionID);
    for (const pathname of [
      `/sessions/${encodedSessionID}/messages`,
      `/session/${encodedSessionID}/messages`,
      `/api/sessions/${encodedSessionID}/messages`,
      `/sessions/${encodedSessionID}`,
      `/session/${encodedSessionID}`,
    ]) {
      try {
        const response = await requestJSON(this.url(pathname));
        const messages = parseOpenCodeSessionMessages(response);
        if (messages.length > 0) return messages;
      } catch {
        continue;
      }
    }

    throw new Error("OpenCode session messages unavailable");
  }
}
