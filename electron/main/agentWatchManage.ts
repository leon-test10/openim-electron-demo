import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";

import { IpcMainToRender } from "../constants";
import { getTerminalWorkspaceDir } from "./workspaceManage";

interface ActiveWatcher {
  workspaceID: string;
  filePath: string;
  watcher?: fs.FSWatcher;
  dirWatcher?: fs.FSWatcher;
  lastOffset: number;
  lastMtimeMs: number;
  webContents: WebContents;
}

const watchers = new Map<string, ActiveWatcher>();

const AGENT_EVENTS_DIR = ".agent";
const AGENT_EVENTS_FILE = "events.ndjson";

const emitStructuredEvent = (
  watcher: ActiveWatcher,
  event: Record<string, unknown>,
) => {
  if (watcher.webContents.isDestroyed()) return;
  watcher.webContents.send(IpcMainToRender.agentStructuredOutput, {
    workspaceID: watcher.workspaceID,
    event,
    timestamp: Date.now(),
  });
};

const readNewLines = (watcher: ActiveWatcher) => {
  try {
    const stat = fs.statSync(watcher.filePath);
    const fileChangedAtSameSize =
      stat.size === watcher.lastOffset &&
      watcher.lastOffset > 0 &&
      stat.mtimeMs !== watcher.lastMtimeMs;

    if (stat.size <= watcher.lastOffset) {
      if (stat.size < watcher.lastOffset || fileChangedAtSameSize) {
        watcher.lastOffset = 0;
      } else {
        watcher.lastMtimeMs = stat.mtimeMs;
        return;
      }
    }

    const buffer = Buffer.alloc(stat.size - watcher.lastOffset);
    const fd = fs.openSync(watcher.filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, buffer.length, watcher.lastOffset);
    } finally {
      fs.closeSync(fd);
    }
    watcher.lastOffset = stat.size;
    watcher.lastMtimeMs = stat.mtimeMs;

    for (const line of buffer.toString("utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          emitStructuredEvent(watcher, parsed as Record<string, unknown>);
        }
      } catch {
        // Ignore partial or malformed NDJSON lines.
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      console.error("[agentWatch] read error:", error);
    }
  }
};

const attachFileWatcher = (watcher: ActiveWatcher) => {
  if (watcher.watcher || !fs.existsSync(watcher.filePath)) return;

  watcher.watcher = fs.watch(watcher.filePath, { persistent: true }, () => {
    readNewLines(watcher);
  });
};

const stopExistingWatcher = (workspaceID: string) => {
  const existing = watchers.get(workspaceID);
  if (!existing) return;

  existing.watcher?.close();
  existing.dirWatcher?.close();
  watchers.delete(workspaceID);
};

export const agentWatchManager = {
  start: async (webContents: WebContents, workspaceID: string) => {
    stopExistingWatcher(workspaceID);

    const workspaceDir = await getTerminalWorkspaceDir(workspaceID);
    const agentDir = path.join(workspaceDir, AGENT_EVENTS_DIR);
    const filePath = path.join(agentDir, AGENT_EVENTS_FILE);

    await fs.promises.mkdir(agentDir, { recursive: true });

    let lastOffset = 0;
    let lastMtimeMs = 0;
    try {
      const stat = fs.statSync(filePath);
      lastOffset = stat.size;
      lastMtimeMs = stat.mtimeMs;
    } catch {
      // The agent may create the file after the terminal starts.
    }

    const watcher: ActiveWatcher = {
      workspaceID,
      filePath,
      lastOffset,
      lastMtimeMs,
      webContents,
    };

    watchers.set(workspaceID, watcher);
    attachFileWatcher(watcher);

    watcher.dirWatcher = fs.watch(agentDir, { persistent: true }, (_event, filename) => {
      if (filename !== AGENT_EVENTS_FILE) return;
      attachFileWatcher(watcher);
      readNewLines(watcher);
    });

    return { ok: true, workspaceID, filePath };
  },

  stop: (workspaceID: string) => {
    stopExistingWatcher(workspaceID);
    return { ok: true, workspaceID };
  },

  stopAll: () => {
    for (const workspaceID of watchers.keys()) {
      stopExistingWatcher(workspaceID);
    }
  },
};
