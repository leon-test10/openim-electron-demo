import fs from "node:fs";
import path from "node:path";

type FolderShareDownloadFile = {
  relativePath?: string;
  fileName?: string;
  name?: string;
  sourceUrl?: string;
};

export type FolderShareDownloadManifest = {
  shareID?: string;
  folderName?: string;
  files?: FolderShareDownloadFile[];
  folders?: string[];
};

export type FolderShareDownloadFailure = {
  relativePath: string;
  reason: string;
};

export type FolderShareDownloadSummary = {
  canceled: boolean;
  targetRoot?: string;
  folderPath?: string;
  folderName: string;
  successCount: number;
  failedCount: number;
  failedFiles: FolderShareDownloadFailure[];
};

type FolderShareDownloadDeps = {
  chooseTargetRoot: () => Promise<string | undefined>;
  downloadUrlToPath: (sourceUrl: URL, targetPath: string) => Promise<string>;
};

const sanitizePathSegment = (value: string) =>
  value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();

const fallbackFolderName = (manifest: FolderShareDownloadManifest) =>
  `folder-share-${manifest.shareID || Date.now()}`;

const safeFolderName = (manifest: FolderShareDownloadManifest) =>
  sanitizePathSegment(manifest.folderName ?? "") ||
  sanitizePathSegment(fallbackFolderName(manifest)) ||
  `folder-share-${Date.now()}`;

const displayPath = (file: FolderShareDownloadFile) =>
  file.relativePath || file.fileName || file.name || "unnamed";

const getSafeRelativePath = (
  relativePath: string | undefined,
  fallbackName: string | undefined,
) => {
  const candidate = (relativePath || fallbackName || "").replaceAll("\\", "/").trim();
  if (!candidate) return undefined;
  if (path.isAbsolute(candidate)) return undefined;

  const parts = candidate.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return undefined;
  }

  const safeParts = parts.map(sanitizePathSegment).filter(Boolean);
  if (safeParts.length === 0) return undefined;
  return safeParts.join(path.sep);
};

const isPathInside = (parentPath: string, childPath: string) => {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const safeJoinInside = (
  rootPath: string,
  relativePath: string | undefined,
  fallbackName?: string,
) => {
  const safeRelativePath = getSafeRelativePath(relativePath, fallbackName);
  if (!safeRelativePath) return undefined;
  const targetPath = path.resolve(rootPath, safeRelativePath);
  return isPathInside(rootPath, targetPath) ? targetPath : undefined;
};

const errorReason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const downloadFolderShare = async (
  manifest: FolderShareDownloadManifest,
  deps: FolderShareDownloadDeps,
): Promise<FolderShareDownloadSummary> => {
  const folderName = safeFolderName(manifest);
  const files = manifest.files ?? [];
  const targetRoot = await deps.chooseTargetRoot();

  if (!targetRoot) {
    return {
      canceled: true,
      folderName,
      successCount: 0,
      failedCount: 0,
      failedFiles: [],
    };
  }

  const folderPath = path.join(targetRoot, folderName);
  const failedFiles: FolderShareDownloadFailure[] = [];
  let successCount = 0;

  console.info("[folder-share] download start", {
    folderName,
    fileCount: files.length,
    targetRoot,
  });

  await fs.promises.mkdir(folderPath, { recursive: true });

  for (const folder of manifest.folders ?? []) {
    const targetFolderPath = safeJoinInside(folderPath, folder, folder);
    if (targetFolderPath) {
      await fs.promises.mkdir(targetFolderPath, { recursive: true });
    }
  }

  for (const file of files) {
    const relativePath = displayPath(file);
    try {
      const targetPath = safeJoinInside(folderPath, file.relativePath, file.fileName || file.name);
      if (!targetPath) {
        throw new Error("Unsafe relative path");
      }
      if (!file.sourceUrl) {
        throw new Error("Missing sourceUrl");
      }
      const sourceUrl = new URL(file.sourceUrl);
      if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
        throw new Error("Only HTTP(S) sourceUrl is supported");
      }

      console.info("[folder-share] download file", {
        relativePath,
        sourceUrl: file.sourceUrl,
      });
      await deps.downloadUrlToPath(sourceUrl, targetPath);
      successCount += 1;
    } catch (error) {
      const reason = errorReason(error);
      failedFiles.push({ relativePath, reason });
      console.warn("[folder-share] download file failed", {
        relativePath,
        error: reason,
      });
    }
  }

  const summary = {
    canceled: false,
    targetRoot,
    folderPath,
    folderName,
    successCount,
    failedCount: failedFiles.length,
    failedFiles,
  };

  console.info("[folder-share] download complete", summary);
  return summary;
};
