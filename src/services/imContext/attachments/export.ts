import { AttachmentExportResult, ContextAttachment } from "./types";

const BLOCKED_AUTO_EXPORT_EXTENSIONS = new Set([
  "appx",
  "appxbundle",
  "bat",
  "cmd",
  "com",
  "cpl",
  "dll",
  "exe",
  "hta",
  "js",
  "jse",
  "lnk",
  "mjs",
  "msi",
  "msix",
  "msixbundle",
  "ps1",
  "psm1",
  "reg",
  "scr",
  "sh",
  "vb",
  "vbe",
  "vbs",
  "wsf",
]);

const getMaxBytes = (attachment: ContextAttachment) => {
  if (attachment.kind === "image") return 20 * 1024 * 1024;
  if (attachment.kind === "video" || attachment.kind === "audio") return 0;
  return 50 * 1024 * 1024;
};

const getAttachmentExtension = (displayName: string) => {
  const extension = displayName.match(/\.([a-z0-9]{1,16})$/i)?.[1]?.toLowerCase();
  return extension;
};

const getBlockedAutoExportReason = (attachment: ContextAttachment) => {
  const extension = getAttachmentExtension(attachment.displayName);
  if (extension && BLOCKED_AUTO_EXPORT_EXTENSIONS.has(extension)) {
    return `Attachment auto-export blocked by policy for .${extension} files`;
  }

  return undefined;
};

export const exportContextAttachments = async ({
  attachments,
  copyFile,
  downloadFile,
}: {
  attachments: ContextAttachment[];
  copyFile: (
    sourcePath: string,
    relativePath: string,
    maxBytes: number,
  ) => Promise<AttachmentExportResult>;
  downloadFile: (
    url: string,
    relativePath: string,
    maxBytes: number,
  ) => Promise<AttachmentExportResult>;
}) => {
  const exported: ContextAttachment[] = [];

  for (const attachment of attachments) {
    const maxBytes = getMaxBytes(attachment);

    if (!attachment.workspaceRelativePath) {
      exported.push(attachment);
      continue;
    }

    if (maxBytes <= 0) {
      exported.push({
        ...attachment,
        status: "skipped",
        error: attachment.error ?? "Attachment type is skipped by export policy",
      });
      continue;
    }

    if (attachment.size && attachment.size > maxBytes) {
      exported.push({
        ...attachment,
        status: "skipped",
        error: `Attachment exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
      });
      continue;
    }

    const blockedReason = getBlockedAutoExportReason(attachment);
    if (blockedReason) {
      exported.push({
        ...attachment,
        status: "skipped",
        error: blockedReason,
      });
      continue;
    }

    let result: AttachmentExportResult | undefined;
    const attemptErrors: string[] = [];

    if (attachment.sourceLocalPath) {
      try {
        result = await copyFile(
          attachment.sourceLocalPath,
          attachment.workspaceRelativePath,
          maxBytes,
        );
      } catch (error) {
        attemptErrors.push(
          `Local copy failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!result && attachment.sourceUrl) {
      try {
        result = await downloadFile(
          attachment.sourceUrl,
          attachment.workspaceRelativePath,
          maxBytes,
        );
      } catch (error) {
        attemptErrors.push(
          `Download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!result) {
      exported.push({
        ...attachment,
        status:
          attemptErrors.length > 0 || attachment.status === "failed"
            ? "failed"
            : "referenced",
        error:
          attemptErrors.join("; ") ||
          attachment.error ||
          "No local path or URL available for export",
      });
      continue;
    }

    exported.push({
      ...attachment,
      status: "exported",
      workspaceAbsolutePath: result.path,
      size: result.size ?? attachment.size,
      sha256: result.sha256 ?? attachment.sha256,
      error: undefined,
    });
  }

  return exported;
};
