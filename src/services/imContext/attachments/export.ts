import { AttachmentExportResult, ContextAttachment } from "./types";

const getMaxBytes = (attachment: ContextAttachment) => {
  if (attachment.kind === "image") return 20 * 1024 * 1024;
  if (attachment.kind === "video" || attachment.kind === "audio") return 0;
  return 50 * 1024 * 1024;
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

    try {
      let result: AttachmentExportResult | undefined;
      let copyError: unknown;

      if (attachment.sourceLocalPath) {
        try {
          result = await copyFile(
            attachment.sourceLocalPath,
            attachment.workspaceRelativePath,
            maxBytes,
          );
        } catch (error) {
          copyError = error;
        }
      }

      if (!result && attachment.sourceUrl) {
        result = await downloadFile(
          attachment.sourceUrl,
          attachment.workspaceRelativePath,
          maxBytes,
        );
      }

      if (!result) {
        exported.push({
          ...attachment,
          status: "referenced",
          error: copyError
            ? `Local copy failed: ${
                copyError instanceof Error ? copyError.message : String(copyError)
              }`
            : "No local path or URL available for export",
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
    } catch (error) {
      exported.push({
        ...attachment,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return exported;
};
