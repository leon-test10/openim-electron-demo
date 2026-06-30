import { existsSync } from "node:fs";

import { WebContents } from "electron";
import { spawn as spawnPty, type IPty } from "node-pty";

import { IpcMainToRender } from "../constants";
import { getCurrentAppConfig } from "./appConfig";
import { getConversationWorkspaceDir } from "./workspaceManage";

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
  id: "terminal";
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

const getTerminalProfile = (cwd: string): RuntimeProfile => {
  const isWin = process.platform === "win32";
  const configuredProfile = getCurrentAppConfig().terminal.profiles[0];
  const shell = configuredProfile?.shell || (isWin ? "powershell.exe" : "bash");
  const args =
    configuredProfile?.args ||
    (isWin
      ? ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass"]
      : ["-l"]);

  return {
    id: "terminal",
    title: "Terminal",
    runtime: "terminal",
    shell,
    args,
    cwd,
    env: configuredProfile?.env || {},
    description:
      "VS Code-like terminal host. OpenIM does not manage agent runtime internals; users can run any CLI here.",
  };
};

const runtimes = new Map<string, ManagedRuntime>();

const getProfile = (profileID: RuntimeProfile["id"]) => {
  if (profileID !== "terminal") throw new Error(`Unknown runtime profile: ${profileID}`);
  return getTerminalProfile(process.cwd());
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
  listProfiles: () => [getTerminalProfile(process.cwd())],

  healthCheck: async () => ({
    ok: true,
    checkedAt: Date.now(),
    message: "ok",
  }),

  start: async (
    webContents: WebContents,
    params: {
      attachmentID: string;
      conversationID: string;
      profileID?: RuntimeProfile["id"];
      command?: string;
    },
  ) => {
    stopExistingRuntime(params.attachmentID);

    const workspaceCwd = await getConversationWorkspaceDir(params.conversationID);
    const profile = getTerminalProfile(workspaceCwd);
    const now = Date.now();
    const cwd = existsSync(profile.cwd) ? profile.cwd : process.cwd();
    const instance: RuntimeInstance = {
      id: params.attachmentID,
      conversationID: params.conversationID,
      profileID: profile.id,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };

    try {
      const child = spawnPty(
        profile.shell,
        profile.args,
        {
          cwd,
          env: {
            ...process.env,
            ...profile.env,
            OPENAI_BASE_URL: getCurrentAppConfig().llm.baseUrl,
            OPENAI_API_KEY: getCurrentAppConfig().llm.apiKey,
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
        data: `${profile.title} started in ${cwd}\r\n`,
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

      if (profile.startupCommand) child.write(`${profile.startupCommand}\r\n`);
      if (params.command) child.write(`${params.command}\r\n`);

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
