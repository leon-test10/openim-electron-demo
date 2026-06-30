import { AppRuntimeConfig } from "@/types/globalExpose";

export const DEFAULT_RUNTIME_CONFIG: AppRuntimeConfig = {
  openim: {
    serverHost: "10.96.253.9",
    apiUrl: "http://10.96.253.9:10002",
    wsUrl: "ws://10.96.253.9:10001",
    chatUrl: "http://10.96.253.9:10008",
  },
  agent: {
    serviceUrl: "http://127.0.0.1:4096",
    bridgeUrl: "http://127.0.0.1:4096",
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
  },
  llm: {
    baseUrl: "http://10.96.248.17:8000/v1",
    apiKey: "not-needed",
    provider: "local-llm",
    model: "default",
  },
};

export const getRuntimeConfig = () => {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_CONFIG;
  return window.electronAPI?.getAppConfig() ?? DEFAULT_RUNTIME_CONFIG;
};
