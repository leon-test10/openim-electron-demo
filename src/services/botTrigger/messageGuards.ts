import { MessageType } from "@openim/wasm-client-sdk";
import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<\/p><p>/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

const parseEx = (ex: unknown): Record<string, unknown> | undefined => {
  if (!ex) return undefined;
  if (typeof ex === "object") return ex as Record<string, unknown>;
  if (typeof ex !== "string") return undefined;

  try {
    const parsed = JSON.parse(ex);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export const extractTextMessageContent = (message: MessageItem) => {
  if (message.contentType !== MessageType.TextMessage) return "";
  return stripHtml(message.textElem?.content);
};

export const isAgentGeneratedMessage = (message: MessageItem) => {
  const ex = parseEx((message as { ex?: unknown }).ex);
  const agent = ex?.agent;
  return Boolean(
    agent &&
      typeof agent === "object" &&
      (agent as Record<string, unknown>).generated_by,
  );
};
