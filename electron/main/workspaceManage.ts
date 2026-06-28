import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { app } from "electron";

const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  ".appx",
  ".appxbundle",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".exe",
  ".hta",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msi",
  ".msix",
  ".msixbundle",
  ".ps1",
  ".psm1",
  ".reg",
  ".scr",
  ".sh",
  ".vb",
  ".vbe",
  ".vbs",
  ".wsf",
]);
const IGNORED_FOLDER_NAMES = new Set([".git", "node_modules"]);
const MAX_FOLDER_FILES = 300;
const MAX_FOLDER_TOTAL_BYTES = 200 * 1024 * 1024;

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

export const statWorkspaceFile = async (
  workspaceID: string,
  relativePath: string,
) => {
  const workspaceDir = await getTerminalWorkspaceDir(workspaceID);
  const resolved = path.resolve(workspaceDir, relativePath);
  if (!resolved.startsWith(path.resolve(workspaceDir) + path.sep)) {
    return { exists: false, isFile: false, isDirectory: false, size: 0, mtimeMs: 0 };
  }
  try {
    const stat = await fs.promises.stat(resolved);
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { exists: false, isFile: false, isDirectory: false, size: 0, mtimeMs: 0 };
  }
};

const scanFolderPath = async (params: {
  folderPath: string;
  folderName?: string;
  maxFiles?: number;
  maxTotalBytes?: number;
}) => {
  const folderPath = path.resolve(params.folderPath);
  const rootStat = await fs.promises.stat(folderPath);
  if (!rootStat.isDirectory()) {
    throw new Error("Path is not a folder");
  }

  const maxFiles = params.maxFiles ?? MAX_FOLDER_FILES;
  const maxTotalBytes = params.maxTotalBytes ?? MAX_FOLDER_TOTAL_BYTES;
  const files: Array<{
    relativePath: string;
    fileName: string;
    nativePath: string;
    size: number;
    mimeType?: string;
  }> = [];
  let totalSize = 0;

  const walk = async (currentDir: string) => {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (entry.isDirectory() && IGNORED_FOLDER_NAMES.has(entry.name)) continue;

      const entryPath = path.join(currentDir, entry.name);
      const stat = await fs.promises.stat(entryPath);
      if (stat.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!stat.isFile()) continue;

      totalSize += stat.size;
      if (files.length >= maxFiles) {
        throw new Error(`Folder contains more than ${maxFiles} files`);
      }
      if (totalSize > maxTotalBytes) {
        throw new Error(
          `Folder exceeds ${Math.round(maxTotalBytes / 1024 / 1024)}MB limit`,
        );
      }
      const relativeFilePath = path
        .relative(folderPath, entryPath)
        .replaceAll("\\", "/");
      files.push({
        relativePath: relativeFilePath,
        fileName: entry.name,
        nativePath: entryPath,
        size: stat.size,
      });
    }
  };

  await walk(folderPath);

  return {
    folderName: params.folderName || path.basename(folderPath),
    itemCount: files.length,
    totalSize,
    files,
  };
};

export const scanWorkspaceFolder = async (params: {
  workspaceID: string;
  relativePath: string;
  maxFiles?: number;
  maxTotalBytes?: number;
}) => {
  const workspaceDir = await getTerminalWorkspaceDir(params.workspaceID);
  const folderPath = ensurePathInsideRoot(workspaceDir, params.relativePath);
  const folderName =
    path.basename(params.relativePath.replace(/[\\/]+$/, "")) ||
    path.basename(folderPath);

  return scanFolderPath({
    folderPath,
    folderName,
    maxFiles: params.maxFiles,
    maxTotalBytes: params.maxTotalBytes,
  });
};

export const scanNativeFolder = async (params: {
  nativePath: string;
  folderName?: string;
  maxFiles?: number;
  maxTotalBytes?: number;
}) => {
  if (!params.nativePath.trim() || !path.isAbsolute(params.nativePath)) {
    throw new Error("Folder path must be an absolute local path");
  }
  if (params.nativePath.startsWith("\\\\")) {
    throw new Error("UNC folder paths are not allowed");
  }
  return scanFolderPath({
    folderPath: params.nativePath,
    folderName: params.folderName,
    maxFiles: params.maxFiles,
    maxTotalBytes: params.maxTotalBytes,
  });
};

function ensurePathInsideRoot(root: string, relativePath: string) {
  if (!relativePath.trim()) {
    throw new Error("Invalid workspace path");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Workspace path must be relative");
  }
  if (/[\0-\x1f]/.test(relativePath) || relativePath.includes(":")) {
    throw new Error("Workspace path contains unsafe characters");
  }

  const resolvedTarget = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid workspace path");
  }

  return resolvedTarget;
}

function ensureAttachmentExportTargetSafe(resolvedTarget: string) {
  const extension = path.extname(resolvedTarget).toLowerCase();
  if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Attachment export blocked by policy for executable/script files (${extension})`,
    );
  }
}

export const writeFileToConversationWorkspace = async (params: {
  conversationID: string;
  relativePath: string;
  content: string;
}) => {
  const conversationDir = await getConversationWorkspaceDir(params.conversationID);
  const resolvedTarget = ensurePathInsideRoot(conversationDir, params.relativePath);

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

function getFileHash(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const ensureSourceFileReadable = async (sourcePath: string, maxBytes: number) => {
  if (!sourcePath.trim() || !path.isAbsolute(sourcePath)) {
    throw new Error("Attachment source path must be an absolute local file path");
  }
  if (sourcePath.startsWith("\\\\")) {
    throw new Error("UNC attachment source paths are not allowed");
  }

  const resolvedSource = path.resolve(sourcePath);
  const lstat = await fs.promises.lstat(resolvedSource);

  if (lstat.isSymbolicLink()) {
    throw new Error("Symbolic-link attachment sources are not allowed");
  }

  const stat = await fs.promises.stat(resolvedSource);

  if (!stat.isFile()) {
    throw new Error("Attachment source is not a file");
  }

  if (maxBytes > 0 && stat.size > maxBytes) {
    throw new Error(`Attachment exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
  }

  return {
    resolvedSource,
    size: stat.size,
  };
};

export const copyFileToTerminalWorkspace = async (params: {
  workspaceID: string;
  sourcePath: string;
  relativePath: string;
  maxBytes?: number;
}) => {
  const workspaceDir = await getTerminalWorkspaceDir(params.workspaceID);
  const resolvedTarget = ensurePathInsideRoot(workspaceDir, params.relativePath);
  ensureAttachmentExportTargetSafe(resolvedTarget);
  const { resolvedSource, size } = await ensureSourceFileReadable(
    params.sourcePath,
    params.maxBytes ?? 0,
  );

  await ensureDir(path.dirname(resolvedTarget));
  await fs.promises.copyFile(resolvedSource, resolvedTarget);
  const buffer = await fs.promises.readFile(resolvedTarget);

  return {
    ok: true,
    path: resolvedTarget,
    size,
    sha256: getFileHash(buffer),
  };
};

const requestBuffer = (
  url: URL,
  maxBytes: number,
  redirectCount = 0,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, (response) => {
      const status = response.statusCode ?? 0;

      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectCount >= 3) {
          reject(new Error("Too many attachment redirects"));
          return;
        }
        resolve(
          requestBuffer(
            new URL(response.headers.location, url),
            maxBytes,
            redirectCount + 1,
          ),
        );
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Attachment download failed with HTTP ${status}`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      const contentLengthHeader = response.headers["content-length"];
      const contentLength = Number(contentLengthHeader);

      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        maxBytes > 0 &&
        contentLength > maxBytes
      ) {
        response.resume();
        reject(new Error("Attachment exceeds download size limit"));
        return;
      }

      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (maxBytes > 0 && total > maxBytes) {
          request.destroy(new Error("Attachment exceeds download size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });

    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error("Attachment download timed out"));
    });
  });

export const downloadFileToTerminalWorkspace = async (params: {
  workspaceID: string;
  url: string;
  relativePath: string;
  maxBytes?: number;
}) => {
  const parsedUrl = new URL(params.url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTP(S) attachment URLs can be downloaded");
  }

  const workspaceDir = await getTerminalWorkspaceDir(params.workspaceID);
  const resolvedTarget = ensurePathInsideRoot(workspaceDir, params.relativePath);
  ensureAttachmentExportTargetSafe(resolvedTarget);
  const buffer = await requestBuffer(parsedUrl, params.maxBytes ?? 0);

  await ensureDir(path.dirname(resolvedTarget));
  await fs.promises.writeFile(resolvedTarget, buffer);

  return {
    ok: true,
    path: resolvedTarget,
    size: buffer.length,
    sha256: getFileHash(buffer),
  };
};
