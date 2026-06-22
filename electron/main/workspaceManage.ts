import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const sanitizeForPath = (value: string) =>
  value
    .replaceAll(/[\\/:*?"<>|]/g, "_")
    .replaceAll(/\s+/g, "_")
    .slice(0, 128);

export const getWorkspaceRoot = () =>
  path.join(app.getPath("userData"), "OpenIMData", "workspaces");

export const ensureDir = async (dir: string) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

export const getConversationWorkspaceDir = async (conversationID: string) => {
  const root = getWorkspaceRoot();
  await ensureDir(root);
  const safe = sanitizeForPath(conversationID || "unknown");
  const conversationDir = path.join(root, safe);
  await ensureDir(conversationDir);
  return conversationDir;
};

export const getTerminalWorkspaceDir = async (workspaceID: string) => {
  const root = getWorkspaceRoot();
  await ensureDir(root);
  const safe = sanitizeForPath(workspaceID || "default");
  const workspaceDir = path.join(root, safe);
  await ensureDir(workspaceDir);
  return workspaceDir;
};

const ensurePathInsideRoot = (root: string, relativePath: string) => {
  const resolvedTarget = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid workspace path");
  }

  return resolvedTarget;
};

export const writeFileToConversationWorkspace = async (params: {
  conversationID: string;
  relativePath: string;
  content: string;
}) => {
  const conversationDir = await getConversationWorkspaceDir(params.conversationID);
  const resolvedTarget = ensurePathInsideRoot(
    conversationDir,
    params.relativePath,
  );

  await ensureDir(path.dirname(resolvedTarget));
  await fs.promises.writeFile(resolvedTarget, params.content, "utf8");
  return {
    ok: true,
    path: resolvedTarget,
  };
};

export const writeFileToTerminalWorkspace = async (params: {
  workspaceID: string;
  relativePath: string;
  content: string;
}) => {
  const workspaceDir = await getTerminalWorkspaceDir(params.workspaceID);
  const resolvedTarget = ensurePathInsideRoot(workspaceDir, params.relativePath);

  await ensureDir(path.dirname(resolvedTarget));
  await fs.promises.writeFile(resolvedTarget, params.content, "utf8");
  return {
    ok: true,
    path: resolvedTarget,
  };
};
