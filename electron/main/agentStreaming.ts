import type { AgentMessage } from "../../src/types/agentSession";
import type { RuntimeSessionEvent } from "./agentRuntimeAdapter";

export const applyRuntimeMessageEvent = (
  messages: AgentMessage[],
  event: RuntimeSessionEvent,
) => {
  if (!event.message && (!event.part || !event.messageID)) return messages;
  const next = messages.map((message) => ({
    ...message,
    parts: [...message.parts],
  }));
  let messageIndex = event.message
    ? next.findIndex((message) => message.id === event.message!.id)
    : next.findIndex((message) => message.id === event.messageID);

  if (messageIndex < 0) {
    const incoming = event.message;
    next.push(
      incoming
        ? { ...incoming, parts: [...incoming.parts] }
        : {
            id: event.messageID!,
            sessionID: event.runtimeSessionID ?? "",
            role: "assistant",
            createdAt: Date.now(),
            parts: [],
          },
    );
    messageIndex = next.length - 1;
  } else if (event.message) {
    next[messageIndex] = {
      ...next[messageIndex],
      ...event.message,
      parts:
        event.message.parts.length > 0
          ? [...event.message.parts]
          : next[messageIndex].parts,
    };
  }

  if (event.part) {
    const message = next[messageIndex];
    const partIndex = message.parts.findIndex((part) => part.id === event.part!.id);
    const incoming = { ...event.part };
    if (event.delta && incoming.text === undefined && partIndex >= 0) {
      incoming.text = `${message.parts[partIndex].text ?? ""}${event.delta}`;
    } else if (event.delta && incoming.text === undefined) {
      incoming.text = event.delta;
    }
    if (partIndex < 0) message.parts.push(incoming);
    else message.parts[partIndex] = { ...message.parts[partIndex], ...incoming };
  }

  return next.sort((a, b) => a.createdAt - b.createdAt);
};
