import { existsSync } from "node:fs";

import type { WebContents } from "electron";
import { spawn as spawnPty, type IPty } from "node-pty";

import { IpcMainToRender } from "../constants";
import { getCurrentAppConfig } from "./appConfig";

export type TerminalStatus =
  | "detached"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export type TerminalEventType =
  | "started"
  | "stdout"
  | "exit"
  | "error"
  | "stopped";

export interface TerminalInstance {
  id: string;
  workspaceID: string;
  cwd: string;
  shell: string;
  status: TerminalStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface TerminalEvent {
  tabID: string;
  type: TerminalEventType;
  data?: string;
  exitCode?: number | null;
  signal?: string | null;
  timestamp: number;
}

interface ManagedTerminal {
  instance: TerminalInstance;
  child: IPty;
  webContents: WebContents;
  disposables: Array<{ dispose: () => void }>;
}

const terminals = new Map<string, ManagedTerminal>();

const getDefaultShell = () => {
  const configuredProfile = getCurrentAppConfig().terminal.profiles[0];
  if (configuredProfile?.shell) {
    return {
      shell: configuredProfile.shell,
      args: Array.isArray(configuredProfile.args) ? configuredProfile.args : [],
      env: configuredProfile.env || {},
    };
  }

  if (process.platform === "win32") {
    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass"],
      env: {},
    };
  }

  return {
    shell: process.env.SHELL || "bash",
    args: ["-l"],
    env: {},
  };
};

const emitTerminalEvent = (
  terminal: Pick<ManagedTerminal, "instance" | "webContents">,
  event: Omit<TerminalEvent, "tabID" | "timestamp">,
) => {
  if (terminal.webContents.isDestroyed()) return;

  terminal.webContents.send(IpcMainToRender.terminalEvent, {
    tabID: terminal.instance.id,
    timestamp: Date.now(),
    ...event,
  } satisfies TerminalEvent);
};

const stopExistingTerminal = (tabID: string) => {
  const terminal = terminals.get(tabID);
  if (!terminal) return;

  terminal.disposables.forEach((item) => item.dispose());
  terminal.child.kill();
  terminals.delete(tabID);
};

export const terminalManager = {
  start: async (
    webContents: WebContents,
    params: {
      tabID: string;
      workspaceID: string;
      cwd: string;
      cols?: number;
      rows?: number;
    },
  ) => {
    stopExistingTerminal(params.tabID);

    const now = Date.now();
    const cwd = existsSync(params.cwd) ? params.cwd : process.cwd();
    const { shell, args, env } = getDefaultShell();
    const instance: TerminalInstance = {
      id: params.tabID,
      workspaceID: params.workspaceID,
      cwd,
      shell,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };

    try {
      const child = spawnPty(shell, args, {
        cwd,
        env: {
          ...process.env,
          ...env,
          OPENAI_BASE_URL: getCurrentAppConfig().llm.baseUrl,
          OPENAI_API_KEY: getCurrentAppConfig().llm.apiKey,
        },
        cols: Math.max(params.cols ?? 120, 20),
        rows: Math.max(params.rows ?? 30, 5),
        name: "xterm-color",
        useConpty: process.platform === "win32",
      });
      const terminal: ManagedTerminal = {
        instance: {
          ...instance,
          status: "running",
          updatedAt: Date.now(),
        },
        child,
        webContents,
        disposables: [],
      };

      terminals.set(params.tabID, terminal);
      emitTerminalEvent(terminal, {
        type: "started",
      });

      terminal.disposables.push(
        child.onData((data) => {
          emitTerminalEvent(terminal, {
            type: "stdout",
            data,
          });
        }),
      );
      terminal.disposables.push(
        child.onExit(({ exitCode, signal }) => {
          terminal.instance = {
            ...terminal.instance,
            status: "stopped",
            updatedAt: Date.now(),
          };
          emitTerminalEvent(terminal, {
            type: "exit",
            exitCode,
            signal,
            data: `\r\n[process exited: code=${exitCode ?? "null"} signal=${
              signal ?? "null"
            }]\r\n`,
          });
          terminals.delete(params.tabID);
        }),
      );

      return terminal.instance;
    } catch (error) {
      return {
        ...instance,
        status: "error" as const,
        updatedAt: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  },

  write: async (params: { tabID: string; data: string }) => {
    const terminal = terminals.get(params.tabID);
    if (!terminal) {
      throw new Error("Terminal is not running");
    }

    terminal.child.write(params.data);
    return {
      ok: true,
      tabID: params.tabID,
      writtenAt: Date.now(),
    };
  },

  interrupt: async (tabID: string) => {
    const terminal = terminals.get(tabID);
    if (!terminal) {
      throw new Error("Terminal is not running");
    }

    terminal.child.write("\x03");
    return {
      ok: true,
      tabID,
      interruptedAt: Date.now(),
    };
  },

  resize: async (params: { tabID: string; cols: number; rows: number }) => {
    const terminal = terminals.get(params.tabID);
    if (!terminal) {
      throw new Error("Terminal is not running");
    }

    terminal.child.resize(Math.max(params.cols, 20), Math.max(params.rows, 5));
    return {
      ok: true,
      tabID: params.tabID,
      resizedAt: Date.now(),
    };
  },

  stop: async (tabID: string) => {
    const terminal = terminals.get(tabID);
    if (!terminal) return undefined;

    emitTerminalEvent(terminal, {
      type: "stopped",
      data: "\r\n[terminal stopped]\r\n",
    });
    stopExistingTerminal(tabID);

    return {
      ...terminal.instance,
      status: "stopped" as const,
      updatedAt: Date.now(),
    };
  },
};
