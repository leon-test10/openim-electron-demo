import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { WebContents } from "electron";
import { spawn as spawnPty, type IPty } from "node-pty";

import { IpcMainToRender } from "../constants";

export type RuntimeInstanceStatus =
  | "detached"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export type RuntimeEventType =
  | "started"
  | "stdout"
  | "stderr"
  | "exit"
  | "error"
  | "stopped";

export interface RuntimeProfile {
  id: "powershell-terminal" | "opencode-terminal";
  title: string;
  runtime: "terminal";
  shell: string;
  args: string[];
  cwd: string;
  startupCommand?: string;
  env: Record<string, string>;
  description: string;
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

export interface RuntimeEvent {
  attachmentID: string;
  type: RuntimeEventType;
  data?: string;
  exitCode?: number | null;
  signal?: string | null;
  timestamp: number;
}

interface ManagedRuntime {
  instance: RuntimeInstance;
  profile: RuntimeProfile;
  child: IPty;
  webContents: WebContents;
  disposables: Array<{ dispose: () => void }>;
}

const getDefaultCwd = () => process.cwd();

const getOpencodeCwd = () => getDefaultCwd();

const resolveExecutableOnPath = (command: string) => {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    candidates.find((candidate) => /\.(cmd|exe|bat)$/i.test(candidate) && existsSync(candidate)) ??
    candidates.find((candidate) => existsSync(candidate))
  );
};

const getOpencodeStartupCommand = (resolvedExecutable?: string) =>
  resolvedExecutable
    ? [
        `Write-Host '[working directory] ${getOpencodeCwd()}'`,
        `Write-Host '[starting opencode] ${resolvedExecutable}'`,
        "opencode",
      ].join("; ")
    : [
        `Write-Host '[working directory] ${getOpencodeCwd()}'`,
        "Write-Host '[opencode CLI not found on PATH. Staying in hosted PowerShell mode.]'",
      ].join("; ");

const profiles: RuntimeProfile[] = [
  {
    id: "powershell-terminal",
    title: "PowerShell Terminal",
    runtime: "terminal",
    shell: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass"],
    cwd: getDefaultCwd(),
    env: {
      OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
      OPENAI_API_KEY: "local",
    },
    description: "Generic PowerShell terminal. Runtime CLIs manage their own config.",
  },
  {
    id: "opencode-terminal",
    title: "opencode Terminal",
    runtime: "terminal",
    shell: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass"],
    cwd: getOpencodeCwd(),
    env: {
      OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
      OPENAI_API_KEY: "local",
    },
    description:
      "PowerShell terminal prepared for opencode. opencode owns provider/model config.",
  },
];

const runtimes = new Map<string, ManagedRuntime>();

const getProfile = (profileID: RuntimeProfile["id"]) => {
  const profile = profiles.find((item) => item.id === profileID);
  if (!profile) {
    throw new Error(`Unknown runtime profile: ${profileID}`);
  }
  return profile;
};

const emitRuntimeEvent = (
  runtime: Pick<ManagedRuntime, "instance" | "webContents">,
  event: Omit<RuntimeEvent, "attachmentID" | "timestamp">,
) => {
  if (runtime.webContents.isDestroyed()) return;

  runtime.webContents.send(IpcMainToRender.runtimeEvent, {
    attachmentID: runtime.instance.id,
    timestamp: Date.now(),
    ...event,
  } satisfies RuntimeEvent);
};

const stopExistingRuntime = (attachmentID: string) => {
  const runtime = runtimes.get(attachmentID);
  if (!runtime) return;

  runtime.disposables.forEach((item) => item.dispose());
  runtime.child.kill();
  runtimes.delete(attachmentID);
};

export const runtimeManager = {
  listProfiles: () => profiles,

  healthCheck: async (profileID: RuntimeProfile["id"]) => {
    const profile = getProfile(profileID);
    return {
      ok: existsSync(profile.cwd),
      profileID,
      checkedAt: Date.now(),
      message: existsSync(profile.cwd)
        ? "Runtime cwd is available"
        : `Runtime cwd does not exist: ${profile.cwd}`,
    };
  },

  start: async (
    webContents: WebContents,
    params: {
      attachmentID: string;
      conversationID: string;
      profileID: RuntimeProfile["id"];
    },
  ) => {
    stopExistingRuntime(params.attachmentID);

    const profile = getProfile(params.profileID);
    const now = Date.now();
    const cwd = existsSync(profile.cwd) ? profile.cwd : getDefaultCwd();
    const instance: RuntimeInstance = {
      id: params.attachmentID,
      conversationID: params.conversationID,
      profileID: profile.id,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };

    try {
      const resolvedOpencode =
        profile.id === "opencode-terminal" ? resolveExecutableOnPath("opencode") : undefined;
      const launchDirectOpencode = Boolean(
        resolvedOpencode && profile.id === "opencode-terminal",
      );
      const startupCommand =
        profile.id === "opencode-terminal" && !launchDirectOpencode
          ? getOpencodeStartupCommand(resolvedOpencode)
          : profile.startupCommand;
      const child = spawnPty(
        launchDirectOpencode ? resolvedOpencode! : profile.shell,
        launchDirectOpencode ? [] : profile.args,
        {
        cwd,
          env: {
            ...process.env,
            ...profile.env,
          },
          cols: 120,
          rows: 30,
          name: "xterm-color",
          useConpty: true,
        },
      );
      const runtime: ManagedRuntime = {
        instance: {
          ...instance,
          status: "running",
          updatedAt: Date.now(),
        },
        profile,
        child,
        webContents,
        disposables: [],
      };

      runtimes.set(params.attachmentID, runtime);
      emitRuntimeEvent(runtime, {
        type: "started",
        data:
          profile.id === "opencode-terminal"
            ? `${profile.title} started in ${cwd}\r\n${
                resolvedOpencode
                  ? `[opencode detected] ${resolvedOpencode}\r\n`
                  : "[opencode CLI not found on PATH]\r\n"
              }`
            : `${profile.title} started in ${cwd}\r\n`,
      });

      runtime.disposables.push(
        child.onData((data) => {
        emitRuntimeEvent(runtime, {
          type: "stdout",
            data,
          });
        }),
      );
      runtime.disposables.push(
        child.onExit(({ exitCode, signal }) => {
          runtime.instance = {
            ...runtime.instance,
            status: "stopped",
            updatedAt: Date.now(),
          };
          emitRuntimeEvent(runtime, {
            type: "exit",
            exitCode,
            signal,
            data: `\r\n[process exited: code=${exitCode ?? "null"} signal=${
              signal ?? "null"
            }]\r\n`,
          });
          runtimes.delete(params.attachmentID);
        }),
      );

      if (startupCommand) {
        child.write(`${startupCommand}\r\n`);
      }

      return runtime.instance;
    } catch (error) {
      return {
        ...instance,
        status: "error" as const,
        updatedAt: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  },

  writeInput: async (params: { attachmentID: string; input: string }) => {
    const runtime = runtimes.get(params.attachmentID);
    if (!runtime) {
      throw new Error("Runtime terminal is not running");
    }

    runtime.child.write(params.input);
    return {
      ok: true,
      attachmentID: params.attachmentID,
      writtenAt: Date.now(),
    };
  },

  interrupt: async (attachmentID: string) => {
    const runtime = runtimes.get(attachmentID);
    if (!runtime) {
      throw new Error("Runtime terminal is not running");
    }

    runtime.child.write("\x03");
    return {
      ok: true,
      attachmentID,
      interruptedAt: Date.now(),
    };
  },

  resize: async (params: { attachmentID: string; cols: number; rows: number }) => {
    const runtime = runtimes.get(params.attachmentID);
    if (!runtime) {
      throw new Error("Runtime terminal is not running");
    }

    runtime.child.resize(Math.max(params.cols, 20), Math.max(params.rows, 5));
    return {
      ok: true,
      attachmentID: params.attachmentID,
      resizedAt: Date.now(),
    };
  },

  stop: async (attachmentID: string) => {
    const runtime = runtimes.get(attachmentID);
    if (!runtime) return undefined;

    emitRuntimeEvent(runtime, {
      type: "stopped",
      data: "\r\n[terminal stopped]\r\n",
    });
    stopExistingRuntime(attachmentID);

    return {
      ...runtime.instance,
      status: "stopped" as const,
      updatedAt: Date.now(),
    };
  },
};
