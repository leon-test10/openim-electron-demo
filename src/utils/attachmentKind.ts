export type AttachmentKind = "image" | "file";

const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export const inferAttachmentKind = (
  fileName: string,
  mimeType?: string,
): AttachmentKind => {
  if (mimeType?.toLowerCase().startsWith("image/")) return "image";

  const extension = fileName.toLowerCase().split(".").pop();
  if (extension && imageExtensions.has(extension)) return "image";

  return "file";
};
