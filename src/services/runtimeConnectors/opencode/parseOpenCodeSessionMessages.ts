const unwrapMessageArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const candidates = [
    record.messages,
    record.data,
    record.items,
    record.events,
    record.result,
  ];

  for (const candidate of candidates) {
    const messages = unwrapMessageArray(candidate);
    if (messages.length > 0) return messages;
  }

  return [];
};

export const parseOpenCodeSessionMessages = (value: unknown) =>
  unwrapMessageArray(value).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
