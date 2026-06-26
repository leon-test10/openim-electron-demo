import { BotConversationType, BotTargetCandidate, BotTriggerResult } from "./types";

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

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const uniqueCandidates = (candidates: BotTargetCandidate[] = []) => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const userID = candidate.userID?.trim();
    if (!userID || seen.has(userID)) return false;
    seen.add(userID);
    return true;
  });
};

const resolveCandidateMention = (
  text: string,
  candidates?: BotTargetCandidate[],
): { userID: string; remaining: string } | undefined => {
  const candidateList = uniqueCandidates(candidates);
  if (candidateList.length === 0) return undefined;

  const candidateMentions = candidateList.flatMap((candidate) =>
    [candidate.userID, candidate.nickname]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => ({
        userID: candidate.userID,
        mention: `@${value.trim()}`,
      })),
  );

  const matched = candidateMentions
    .filter((item) => normalize(text).startsWith(normalize(item.mention)))
    .sort((a, b) => b.mention.length - a.mention.length);

  if (matched.length === 0) return undefined;

  const first = matched[0];
  const sameLengthMatches = matched.filter(
    (item) => normalize(item.mention) === normalize(first.mention),
  );
  const uniqueUserIDs = new Set(sameLengthMatches.map((item) => item.userID));

  if (uniqueUserIDs.size > 1) return undefined;

  const remaining = text.slice(first.mention.length);
  if (remaining && !/^\s/.test(remaining)) return undefined;

  return {
    userID: first.userID,
    remaining: remaining.trim(),
  };
};

export function detectBotTrigger(args: {
  text: string;
  currentUserID?: string;
  conversationType?: BotConversationType;
  botAliases?: string[];
  targetCandidates?: BotTargetCandidate[];
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
      new RegExp(`^${escapeRegExp(alias)}(?=\\s+|@|$)`, "i"),
    );
    if (!aliasMatch) continue;

    const afterAlias = candidateText.slice(aliasMatch[0].length).trimStart();

    // A target mention is mandatory. Bare `@bot` is too easy to send by
    // accident, especially with Auto Inject enabled.
    if (!afterAlias.startsWith("@")) return null;

    const mention =
      resolveCandidateMention(afterAlias, args.targetCandidates) ??
      extractUserMention(afterAlias);
    const targetUserID = mention?.userID;
    if (!targetUserID) return null;

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
