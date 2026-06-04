import { SessionType } from "@openim/wasm-client-sdk";

interface ConversationLike {
  conversationID?: string;
  conversationType?: number;
  userID?: string;
}

export function isCodexSingleConversation(
  conversation: ConversationLike | undefined,
  routeConversationID: string | undefined,
  botUserID: string,
) {
  if (
    conversation?.conversationType === SessionType.Single &&
    conversation.userID === botUserID
  ) {
    return true;
  }

  return isCodexConversationID(routeConversationID, botUserID);
}

export function resolveCodexConversationID(
  conversation: ConversationLike | undefined,
  routeConversationID: string | undefined,
) {
  return conversation?.conversationID ?? routeConversationID;
}

function isCodexConversationID(conversationID: string | undefined, botUserID: string) {
  if (!conversationID) {
    return false;
  }

  if (conversationID.startsWith(`single:${botUserID}:`)) {
    return true;
  }

  if (!conversationID.startsWith("si_")) {
    return false;
  }

  return (
    conversationID.endsWith(`_${botUserID}`) ||
    conversationID.startsWith(`si_${botUserID}_`)
  );
}
