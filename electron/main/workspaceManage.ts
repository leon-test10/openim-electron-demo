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
    return { exists: false, isFile: false, size: 0, mtimeMs: 0 };
  }
  try {
    const stat = await fs.promises.stat(resolved);
    return {
      exists: true,
      isFile: stat.isFile(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { exists: false, isFile: false, size: 0, mtimeMs: 0 };
  }
};

const ensurePathInsideRoot = (root: string, relativePath: string) => {
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
};

const ensureAttachmentExportTargetSafe = (resolvedTarget: string) => {
  const extension = path.extname(resolvedTarget).toLowerCase();
  if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Attachment export blocked by policy for executable/script files (${extension})`,
    );
  }
};

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

const getFileHash = (buffer: Buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

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
