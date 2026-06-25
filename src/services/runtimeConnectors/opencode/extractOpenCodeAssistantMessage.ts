const extractText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractText(item))
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
    return text || undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "markdown", "answer"]) {
    const text = extractText(record[key]);
    if (text) return text;
  }

  return undefined;
};

const isAssistantLike = (message: Record<string, unknown>) => {
  const role = String(message.role ?? message.type ?? message.kind ?? "").toLowerCase();
  return (
    role.includes("assistant") ||
    role.includes("agent") ||
    role.includes("final_answer")
  );
};

export const extractOpenCodeAssistantMessage = (
  messages: Record<string, unknown>[],
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantLike(message)) continue;

    const text = extractText(message);
    if (text) return text;
  }

  return undefined;
};
