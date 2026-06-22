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

export const writeFileToConversationWorkspace = async (params: {
  conversationID: string;
  relativePath: string;
  content: string;
}) => {
  const conversationDir = await getConversationWorkspaceDir(params.conversationID);
  const resolvedTarget = path.resolve(conversationDir, params.relativePath);
  const resolvedRoot = path.resolve(conversationDir);

  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error("Invalid workspace path");
  }

  await ensureDir(path.dirname(resolvedTarget));
  await fs.promises.writeFile(resolvedTarget, params.content, "utf8");
  return {
    ok: true,
    path: resolvedTarget,
  };
};

