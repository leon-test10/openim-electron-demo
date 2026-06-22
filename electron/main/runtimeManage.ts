import http from "node:http";
import https from "node:https";

export type RuntimeInstanceStatus =
  | "detached"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export interface RuntimeProfile {
  id: "opencode-local";
  title: string;
  runtime: "opencode";
  adapter: "openai-compatible-local";
  baseURL: string;
  model: string;
  apiKey: string;
  offlineBundleID: string;
}

export interface RuntimeInstance {
  id: string;
  conversationID: string;
  profileID: RuntimeProfile["id"];
  status: RuntimeInstanceStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const profiles: RuntimeProfile[] = [
  {
    id: "opencode-local",
    title: "opencode-local",
    runtime: "opencode",
    adapter: "openai-compatible-local",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    apiKey: "local",
    offlineBundleID: "opencode-win-x64-local",
  },
];

const instances = new Map<string, RuntimeInstance>();

const getProfile = (profileID: RuntimeProfile["id"]) => {
  const profile = profiles.find((item) => item.id === profileID);
  if (!profile) {
    throw new Error(`Unknown runtime profile: ${profileID}`);
  }
  return profile;
};

const requestJSON = <T>(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<T> => {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: init?.method ?? "GET",
        headers: init?.headers,
        timeout: init?.timeoutMs ?? 30_000,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Runtime request timed out"));
    });
    req.on("error", reject);

    if (init?.body) {
      req.write(init.body);
    }
    req.end();
  });
};

export const runtimeManager = {
  listProfiles: () => profiles,

  healthCheck: async (profileID: RuntimeProfile["id"]) => {
    const profile = getProfile(profileID);
    await requestJSON(`${profile.baseURL}/models`, { timeoutMs: 5_000 });
    return {
      ok: true,
      profileID,
      checkedAt: Date.now(),
    };
  },

  start: async (params: {
    attachmentID: string;
    conversationID: string;
    profileID: RuntimeProfile["id"];
  }) => {
    const profile = getProfile(params.profileID);
    const now = Date.now();
    const instance: RuntimeInstance = {
      id: params.attachmentID,
      conversationID: params.conversationID,
      profileID: profile.id,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };
    instances.set(params.attachmentID, instance);

    try {
      await runtimeManager.healthCheck(profile.id);
      const runningInstance = {
        ...instance,
        status: "running" as const,
        updatedAt: Date.now(),
      };
      instances.set(params.attachmentID, runningInstance);
      return runningInstance;
    } catch (error) {
      const failedInstance = {
        ...instance,
        status: "error" as const,
        updatedAt: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      instances.set(params.attachmentID, failedInstance);
      return failedInstance;
    }
  },

  stop: async (attachmentID: string) => {
    const current = instances.get(attachmentID);
    if (!current) return undefined;

    const stoppedInstance = {
      ...current,
      status: "stopped" as const,
      updatedAt: Date.now(),
    };
    instances.set(attachmentID, stoppedInstance);
    return stoppedInstance;
  },

  sendPrompt: async (params: { attachmentID: string; prompt: string }) => {
    const instance = instances.get(params.attachmentID);
    if (!instance) {
      throw new Error("Runtime instance is not started");
    }
    if (instance.status !== "running") {
      throw new Error(`Runtime instance is ${instance.status}`);
    }

    const profile = getProfile(instance.profileID);
    const messages: ChatCompletionMessage[] = [
      {
        role: "system",
        content:
          "You are the opencode-local runtime smoke adapter inside OpenIM. Reply concisely.",
      },
      {
        role: "user",
        content: params.prompt,
      },
    ];
    const response = await requestJSON<ChatCompletionResponse>(
      `${profile.baseURL}/chat/completions`,
      {
        method: "POST",
        timeoutMs: 120_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          temperature: 0,
          max_tokens: 512,
        }),
      },
    );

    const output = response.choices?.[0]?.message?.content?.trim();
    if (!output) {
      throw new Error("Runtime returned an empty response");
    }

    return {
      attachmentID: params.attachmentID,
      output,
      completedAt: Date.now(),
    };
  },
};
