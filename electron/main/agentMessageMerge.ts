import type { AgentMessage } from "../../src/types/agentSession";

const messageText = (message: AgentMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

const LOCAL_RUNTIME_MATCH_WINDOW_MS = 30_000;

export const mergeAgentRuntimeMessages = (
  cachedMessages: AgentMessage[],
  runtimeMessages: AgentMessage[],
) => {
  const runtimeIDs = new Set(runtimeMessages.map((message) => message.id));
  const runtimeUserMessages = runtimeMessages.filter(
    (message) => message.role === "user",
  );
  const matchedRuntimeIDs = new Set<string>();

  const localMessages = cachedMessages.filter((message) => {
    if (!message.id.startsWith("local_")) return false;
    if (runtimeIDs.has(message.id)) return false;
    if (message.role !== "user") return true;

    const text = messageText(message);
    const match = runtimeUserMessages.find(
      (candidate) =>
        !matchedRuntimeIDs.has(candidate.id) &&
        messageText(candidate) === text &&
        candidate.createdAt >= message.createdAt - 1_000 &&
        candidate.createdAt - message.createdAt <= LOCAL_RUNTIME_MATCH_WINDOW_MS,
    );
    if (!match) return true;
    matchedRuntimeIDs.add(match.id);
    return false;
  });

  return [...runtimeMessages, ...localMessages].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
};
