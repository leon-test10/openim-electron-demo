import fs from "node:fs";
import path from "node:path";

import type { AgentMessage, AgentSession } from "../../src/types/agentSession";

type SessionMetadata = {
  version?: number;
  id?: string;
  conversationID?: string;
  kind?: AgentSession["kind"];
  title?: string;
  runtime?: string;
  runtimeSessionID?: string;
  workspacePath?: string;
  updatedAt?: number;
  archived?: boolean;
  pinned?: boolean;
  liveHistoryEnabled?: boolean;
};

const readJSON = async (filePath: string) => {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

const isMetadata = (value: unknown): value is SessionMetadata =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const recoverWorkspace = async (
  workspaceValue: string,
  knownSessionIDs: Set<string>,
  managedWorkspace: boolean,
): Promise<AgentSession | undefined> => {
  const workspacePath = path.resolve(workspaceValue);
  const metadataPath = path.join(workspacePath, ".openim-agent", "session.json");
  const metadataValue = await readJSON(metadataPath);
  if (!isMetadata(metadataValue)) return undefined;
  const metadata = metadataValue;
  if (
    metadata.version !== 1 ||
    typeof metadata.id !== "string" ||
    !metadata.id.startsWith("agent_session_") ||
    knownSessionIDs.has(metadata.id) ||
    typeof metadata.conversationID !== "string" ||
    !metadata.conversationID ||
    metadata.runtime !== "opencode" ||
    (metadata.kind !== "manual" && metadata.kind !== "bot")
  ) {
    return undefined;
  }
  if (
    typeof metadata.workspacePath === "string" &&
    path.resolve(metadata.workspacePath).toLowerCase() !== workspacePath.toLowerCase()
  ) {
    return undefined;
  }

  const messagesValue = await readJSON(
    path.join(workspacePath, ".openim-agent", "messages.json"),
  );
  const messages = Array.isArray(messagesValue)
    ? (messagesValue as AgentMessage[])
    : [];
  const metadataStat = await fs.promises.stat(metadataPath).catch(() => undefined);
  const updatedAt =
    typeof metadata.updatedAt === "number"
      ? metadata.updatedAt
      : metadataStat?.mtimeMs ?? Date.now();
  const earliestMessageAt = messages.reduce(
    (earliest, message) => Math.min(earliest, message.createdAt),
    Number.POSITIVE_INFINITY,
  );
  const createdAt = Number.isFinite(earliestMessageAt)
    ? earliestMessageAt
    : metadataStat?.birthtimeMs ?? updatedAt;
  const kind = metadata.kind;

  return {
    id: metadata.id,
    conversationID: metadata.conversationID,
    kind,
    title:
      typeof metadata.title === "string" && metadata.title.trim()
        ? metadata.title
        : kind === "bot"
        ? "Bot Requests"
        : "Recovered Agent session",
    runtime: "opencode",
    runtimeSessionID:
      typeof metadata.runtimeSessionID === "string"
        ? metadata.runtimeSessionID
        : undefined,
    workspacePath,
    managedWorkspace,
    status: metadata.archived ? "archived" : "disconnected",
    pinned: metadata.pinned ?? kind === "bot",
    archived: metadata.archived === true,
    unreadCount: 0,
    liveHistoryEnabled: metadata.liveHistoryEnabled ?? kind !== "bot",
    autoReplyTextEnabled: false,
    autoFileAttachmentEnabled: false,
    createdAt,
    updatedAt,
    lastOpenedAt: updatedAt,
    messages,
    turns: [],
    interactions: [],
    stagedResults: [],
    traceSummaries: [],
  } satisfies AgentSession;
};

export const discoverManagedAgentSessions = async (
  workspaceRoot: string,
  knownSessionIDs: Set<string>,
) => {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const recovered = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent_session_"))
      .map((entry) =>
        recoverWorkspace(path.join(workspaceRoot, entry.name), knownSessionIDs, true),
      ),
  );
  return recovered.filter((session): session is AgentSession => Boolean(session));
};

const SKIPPED_DIRECTORY_NAMES = new Set([".git", ".openim-agent", "node_modules"]);

export const discoverExternalAgentSessions = async (
  searchRoots: string[],
  knownSessionIDs: Set<string>,
  maxDepth = 4,
) => {
  const candidates = new Set<string>();
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (
      entries.some((entry) => entry.isDirectory() && entry.name === ".openim-agent")
    ) {
      candidates.add(path.resolve(directory));
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        SKIPPED_DIRECTORY_NAMES.has(entry.name)
      ) {
        continue;
      }
      await walk(path.join(directory, entry.name), depth + 1);
    }
  };

  for (const root of new Set(searchRoots.map((item) => path.resolve(item)))) {
    await walk(root, 0);
  }

  const recovered: AgentSession[] = [];
  for (const workspacePath of candidates) {
    const session = await recoverWorkspace(workspacePath, knownSessionIDs, false);
    if (!session) continue;
    knownSessionIDs.add(session.id);
    recovered.push(session);
  }
  return recovered;
};
