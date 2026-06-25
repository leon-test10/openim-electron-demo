import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";

import { IpcMainToRender } from "../constants";
import { getTerminalWorkspaceDir } from "./workspaceManage";

interface ActiveWatcher {
  workspaceID: string;
  filePath: string;
  watcher: fs.FSWatcher;
  lastOffset: number;
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
    if (stat.size <= watcher.lastOffset) {
      // File was truncated or hasn't grown — reset offset for truncation case
      if (stat.size < watcher.lastOffset) {
        watcher.lastOffset = 0;
      }
      return;
    }

    const buffer = Buffer.alloc(stat.size - watcher.lastOffset);
    const fd = fs.openSync(watcher.filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, buffer.length, watcher.lastOffset);
    } finally {
      fs.closeSync(fd);
    }
    watcher.lastOffset = stat.size;

    const text = buffer.toString("utf8");
    const lines = text.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          emitStructuredEvent(watcher, parsed as Record<string, unknown>);
        }
      } catch {
        // Skip malformed JSON lines silently
      }
    }
  } catch (error) {
    // File may not exist yet — that's fine, agent hasn't started writing
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      console.error("[agentWatch] read error:", error);
    }
  }
};

export const agentWatchManager = {
  start: async (webContents: WebContents, workspaceID: string) => {
    stopExistingWatcher(workspaceID);

    const workspaceDir = await getTerminalWorkspaceDir(workspaceID);
    const agentDir = path.join(workspaceDir, AGENT_EVENTS_DIR);
    const filePath = path.join(agentDir, AGENT_EVENTS_FILE);

    // Ensure .agent directory exists so the agent can write into it
    await fs.promises.mkdir(agentDir, { recursive: true });

    // Read initial offset from existing file (if any)
    let lastOffset = 0;
    try {
      const stat = fs.statSync(filePath);
      lastOffset = stat.size;
    } catch {
      // File doesn't exist yet — start from 0
    }

    const watcher: ActiveWatcher = {
      workspaceID,
      filePath,
      watcher: fs.watch(filePath, { persistent: true }, () => {
        readNewLines(watcher);
      }),
      lastOffset,
      webContents,
    };

    watchers.set(workspaceID, watcher);

    // Also poll on the parent directory in case the file is created after watch starts
    const dirWatcher = fs.watch(agentDir, { persistent: true }, (_event, filename) => {
      if (filename === AGENT_EVENTS_FILE) {
        readNewLines(watcher);
      }
    });

    // Store the dir watcher reference (we'll close both on stop)
    (watcher as unknown as { dirWatcher: fs.FSWatcher }).dirWatcher = dirWatcher;

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

const stopExistingWatcher = (workspaceID: string) => {
  const existing = watchers.get(workspaceID);
  if (!existing) return;

  existing.watcher.close();
  const dirWatcher = (existing as unknown as { dirWatcher?: fs.FSWatcher })
    .dirWatcher;
  if (dirWatcher) dirWatcher.close();
  watchers.delete(workspaceID);
};
