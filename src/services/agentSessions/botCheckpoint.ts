import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

export const splitHistoryPageAfterCheckpoint = (
  messages: MessageItem[],
  checkpointClientMsgID?: string,
) => {
  if (!checkpointClientMsgID) return { messages, checkpointFound: false };
  const checkpointIndex = messages.findIndex(
    (message) => message.clientMsgID === checkpointClientMsgID,
  );
  if (checkpointIndex < 0) return { messages, checkpointFound: false };
  return {
    messages: messages.slice(checkpointIndex + 1),
    checkpointFound: true,
  };
};
