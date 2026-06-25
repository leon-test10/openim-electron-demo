import { BotConversationType, BotTriggerResult } from "./types";

const DEFAULT_BOT_ALIASES = ["@bot", "/bot"];

/** Matches a @userID mention in plain text. */
const USER_MENTION_RE = /@(\S+?)(?:\s|$)/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");

/**
 * Strip a leading mention of `currentUserID` from the text.
 * In group chats, the sender may mention the bot user first, e.g.:
 * `@botUserID @bot @targetUserID instruction`
 */
const stripLeadingLocalMention = (text: string, currentUserID?: string) => {
  if (!currentUserID) return text;
  const mentionPattern = new RegExp(`^@${escapeRegExp(currentUserID)}\\b\\s*`, "i");
  return text.replace(mentionPattern, "");
};

/**
 * Extract a @userID mention from the start of `text`.
 * Returns the userID and the remaining text after the mention.
 */
const extractUserMention = (
  text: string,
): { userID: string; remaining: string } | undefined => {
  const match = text.match(USER_MENTION_RE);
  if (!match) return undefined;

  const userID = match[1];
  if (!userID) return undefined;

  return {
    userID,
    remaining: text.slice(match[0].length),
  };
};

export function detectBotTrigger(args: {
  text: string;
  currentUserID?: string;
  conversationType?: BotConversationType;
  botAliases?: string[];
}): BotTriggerResult | null {
  const rawText = args.text.trim();
  if (!rawText) return null;

  const aliases = args.botAliases?.length ? args.botAliases : DEFAULT_BOT_ALIASES;

  // In group chats, strip a leading @currentUserID mention first.
  const candidateText =
    args.conversationType === "group"
      ? stripLeadingLocalMention(rawText, args.currentUserID).trim()
      : rawText;

  // Check if the text starts with a bot alias.
  for (const alias of aliases) {
    const aliasMatch = candidateText.match(
      new RegExp(`^${escapeRegExp(alias)}(?:\\s+|$)`, "i"),
    );
    if (!aliasMatch) continue;

    const afterAlias = candidateText.slice(aliasMatch[0].length).trim();

    // Look for @targetUserID mention after the bot alias.
    const mention = extractUserMention(afterAlias);
    const targetUserID = mention?.userID;
    const instructionText = mention ? mention.remaining.trim() : afterAlias.trim();

    return {
      triggerKind: alias.startsWith("/") ? "slashBot" : "mentionBot",
      alias,
      rawText,
      instructionText,
      targetUserID,
    };
  }

  return null;
}
