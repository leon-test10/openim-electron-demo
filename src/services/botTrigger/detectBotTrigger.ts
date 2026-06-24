import { BotConversationType, BotTriggerResult } from "./types";

const DEFAULT_BOT_ALIASES = ["@bot", "/bot"];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripLeadingLocalMention = (text: string, currentUserID?: string) => {
  if (!currentUserID) return text;
  const mentionPattern = new RegExp(`^@${escapeRegExp(currentUserID)}\\b\\s*`, "i");
  return text.replace(mentionPattern, "");
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
  const candidateText =
    args.conversationType === "group"
      ? stripLeadingLocalMention(rawText, args.currentUserID).trim()
      : rawText;

  for (const alias of aliases) {
    const match = candidateText.match(
      new RegExp(`^${escapeRegExp(alias)}(?:\\s+|$)`, "i"),
    );
    if (!match) continue;

    return {
      triggerKind: alias.startsWith("/") ? "slashBot" : "mentionBot",
      alias,
      rawText,
      instructionText: candidateText.slice(match[0].length).trim(),
    };
  }

  return null;
}
