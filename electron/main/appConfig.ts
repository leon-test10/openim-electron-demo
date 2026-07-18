import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  openim: {
    serverHost: string;
    apiUrl: string;
    wsUrl: string;
    chatUrl: string;
  };
  agent: {
    serviceUrl: string;
    bridgeUrl: string;
    gateway: {
      enabled: boolean;
      hostname: string;
      port: number;
      authToken: string;
      heartbeatTtlMs: number;
    };
  };
  terminal: {
    defaultWorkspacePath: string;
    profiles: Array<{
      id: string;
      title: string;
      shell: string;
      args: string[];
      env: Record<string, string>;
    }>;
  };
  opencode: {
    command: string;
    args: string[];
    serverHost: string;
    serverPort: number;
    workspaceConfig: {
      enabled: boolean;
      mode: "create-if-missing" | "overwrite";
      fileName: string;
      templatePath: string;
    };
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    provider: string;
    model: string;
  };
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  openim: {
    serverHost: "10.96.253.9",
    apiUrl: "http://10.96.253.9:10002",
    wsUrl: "ws://10.96.253.9:10001",
    chatUrl: "http://10.96.253.9:10008",
  },
  agent: {
    serviceUrl: "http://127.0.0.1:4096",
    bridgeUrl: "http://127.0.0.1:4096",
    gateway: {
      enabled: true,
      hostname: "127.0.0.1",
      port: 4097,
      authToken: "",
      heartbeatTtlMs: 30000,
    },
  },
  terminal: {
    defaultWorkspacePath: "%USERPROFILE%\\OpenIM-Agent\\workspaces",
    profiles: [
      {
        id: "powershell",
        title: "PowerShell",
        shell: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass"],
        env: {},
      },
    ],
  },
  opencode: {
    command: "opencode",
    args: [],
    serverHost: "127.0.0.1",
    serverPort: 4096,
    workspaceConfig: {
      enabled: true,
      mode: "create-if-missing",
      fileName: "opencode.jsonc",
      templatePath: "",
    },
  },
  llm: {
    baseUrl: "http://10.96.248.17:8000/v1",
    apiKey: "not-needed",
    provider: "local-llm",
    model: "default",
  },
};

let currentAppConfig = DEFAULT_APP_CONFIG;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const mergeRecord = <T extends Record<string, unknown>>(base: T, patch: unknown): T => {
  if (!isRecord(patch)) return { ...base };

  const merged: Record<string, unknown> = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    const baseValue = merged[key];
    if (Array.isArray(baseValue)) {
      merged[key] = Array.isArray(value) ? value : baseValue;
      return;
    }
    if (isRecord(baseValue)) {
      merged[key] = mergeRecord(baseValue, value);
      return;
    }
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  });
  return merged as T;
};

export const mergeAppConfig = (patch: unknown): AppConfig =>
  mergeRecord(
    DEFAULT_APP_CONFIG as unknown as Record<string, unknown>,
    patch,
  ) as unknown as AppConfig;

export const resolveConfiguredPath = (
  value: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const expanded = value.replace(/%([^%]+)%/g, (_, name: string) => {
    const replacement = env[name];
    return typeof replacement === "string" ? replacement : `%${name}%`;
  });
  return path.normalize(expanded);
};

export const getUserConfigPath = (userDataPath: string) =>
  path.join(userDataPath, "config.json");

const withBundledOpencodePath = (defaults: AppConfig, bundledOpencodePath?: string) => {
  if (!bundledOpencodePath || !fs.existsSync(bundledOpencodePath)) return defaults;
  return mergeRecord(defaults as unknown as Record<string, unknown>, {
    opencode: {
      command: bundledOpencodePath,
    },
  }) as unknown as AppConfig;
};

export const loadAppConfig = (params: {
  userDataPath: string;
  defaultConfigPath?: string;
  bundledOpencodePath?: string;
}) => {
  const configPath = getUserConfigPath(params.userDataPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  let defaults: AppConfig = DEFAULT_APP_CONFIG;
  if (params.defaultConfigPath && fs.existsSync(params.defaultConfigPath)) {
    const rawDefaults = JSON.parse(fs.readFileSync(params.defaultConfigPath, "utf8"));
    defaults = mergeRecord(
      DEFAULT_APP_CONFIG as unknown as Record<string, unknown>,
      rawDefaults,
    ) as unknown as AppConfig;
  }
  defaults = withBundledOpencodePath(defaults, params.bundledOpencodePath);

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    currentAppConfig = defaults;
    return defaults;
  }

  const rawUserConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const merged = mergeRecord(
    defaults as unknown as Record<string, unknown>,
    rawUserConfig,
  ) as unknown as AppConfig;
  const userOpencode = isRecord(rawUserConfig.opencode)
    ? rawUserConfig.opencode
    : undefined;
  const userCommand = userOpencode?.command;
  if (
    params.bundledOpencodePath &&
    fs.existsSync(params.bundledOpencodePath) &&
    (typeof userCommand !== "string" || userCommand === "opencode")
  ) {
    merged.opencode.command = params.bundledOpencodePath;
  }
  fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  currentAppConfig = merged;
  return merged;
};

export const getCurrentAppConfig = () => currentAppConfig;
