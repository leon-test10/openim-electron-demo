const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const stripControlChars = (value: string) =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");

export const hashText = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
};

export const safeFileName = (input: string, fallback = "attachment") => {
  const normalized = stripControlChars(input || fallback)
    .replace(/[\\/]+/g, "_")
    .replace(/:/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/[?*"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const safe = normalized.replace(/^\.+/, "").slice(0, 120).trim();
  if (!safe || RESERVED_WINDOWS_NAMES.test(safe)) return fallback;
  return safe;
};

export const safePathSegment = (input: string, fallback = "unknown") =>
  safeFileName(input, fallback).replace(/\s+/g, "_");

export const getExtension = (fileName?: string) => {
  const match = fileName?.match(/\.([a-z0-9]{1,12})$/i);
  return match?.[1]?.toLowerCase();
};

export const mimeFromName = (fileName?: string) => {
  const extension = getExtension(fileName);

  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "log":
    case "md":
    case "json":
    case "csv":
      return "text/plain";
    case "mp4":
    case "mov":
    case "webm":
      return "video/mp4";
    case "mp3":
    case "wav":
    case "m4a":
      return "audio/mpeg";
    default:
      return undefined;
  }
};

export const inferKindFromFileName = (fileName?: string) => {
  const extension = getExtension(fileName);

  if (!extension) return "file" as const;
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(extension)) {
    return "image" as const;
  }
  if (extension === "pdf") return "pdf" as const;
  if (["txt", "log", "md", "json", "csv", "yaml", "yml"].includes(extension)) {
    return "text" as const;
  }
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(extension)) {
    return "video" as const;
  }
  if (["mp3", "wav", "m4a", "flac", "ogg"].includes(extension)) {
    return "audio" as const;
  }
  return "file" as const;
};

export const generateAttachmentId = (args: {
  clientMsgID: string;
  index: number;
  sourceUrl?: string;
  sourceLocalPath?: string;
  displayName?: string;
  size?: number;
  mime?: string;
}) => {
  const hash = hashText(
    [
      args.clientMsgID,
      args.index,
      args.sourceUrl,
      args.sourceLocalPath,
      args.displayName,
      args.size,
      args.mime,
    ]
      .filter((item) => item !== undefined && item !== "")
      .join("|"),
  );

  return `att_${safePathSegment(args.clientMsgID, "msg")}_${args.index}_${hash}`;
};

export const getAttachmentWorkspacePath = (args: {
  bundleId: string;
  clientMsgID: string;
  attachmentId: string;
  displayName: string;
}) =>
  [
    "attachments",
    safePathSegment(args.bundleId, "bundle"),
    `msg_${safePathSegment(args.clientMsgID, "unknown")}`,
    `${args.attachmentId}_${safeFileName(args.displayName, args.attachmentId)}`,
  ].join("/");
