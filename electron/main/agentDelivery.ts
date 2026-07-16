import fs from "node:fs";
import path from "node:path";

import type {
  AgentDeliveryAttachment,
  AgentMessage,
} from "../../src/types/agentSession";

const SECTION_HEADING = /^##\s+Output (Files|Folders)\s*$/i;

const parseSection = (text: string, expected: "Files" | "Folders") => {
  const result: string[] = [];
  let active = false;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const heading = line.trim().match(SECTION_HEADING);
    if (heading) {
      active = heading[1].toLowerCase() === expected.toLowerCase();
      continue;
    }
    if (active && /^##\s+/.test(line.trim())) break;
    if (!active) continue;
    const item = line
      .trim()
      .match(/^[-*]\s+(.+?)\s*$/)?.[1]
      ?.trim();
    if (item) result.push(item.replace(/^`|`$/g, ""));
  }
  return result;
};

const stripOutputSections = (text: string) => {
  const lines = text.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (SECTION_HEADING.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+/.test(line.trim())) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").trim();
};

const isImagePath = (value: string) =>
  /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(value);

const resolveWorkspacePath = (workspacePath: string, value: string) => {
  const cleaned = value.trim().replace(/^file:\/\//i, "");
  const candidate = path.resolve(workspacePath, cleaned);
  const relative = path.relative(path.resolve(workspacePath), candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return { candidate, relative: relative.replaceAll("\\", "/") };
};

export const resolveAgentDelivery = async (
  workspacePath: string,
  messageOrMessages: AgentMessage | AgentMessage[],
) => {
  const messages = Array.isArray(messageOrMessages)
    ? messageOrMessages
    : [messageOrMessages];
  const finalMessage = messages[messages.length - 1];
  const rawText = finalMessage.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
  const toolOutputPaths: string[] = [];
  const collectPathValues = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if (/^(?:file)?path$/i.test(key)) toolOutputPaths.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectPathValues(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) =>
      collectPathValues(child, childKey),
    );
  };
  messages.forEach((message) =>
    message.parts
      .filter(
        (part) =>
          part.type === "tool" &&
          /^(?:write|edit|apply_patch|patch|mkdir|create_directory)$/i.test(
            part.name ?? "",
          ) &&
          part.status === "completed",
      )
      .forEach((part) => collectPathValues(part.metadata)),
  );
  const inlinePaths = [...rawText.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1]);
  const filePaths = [
    ...parseSection(rawText, "Files"),
    ...toolOutputPaths,
    ...inlinePaths,
    ...messages.flatMap((message) =>
      message.parts
        .filter((part) => part.type === "file" && part.path)
        .map((part) => part.path!),
    ),
  ];
  const folderPaths = parseSection(rawText, "Folders");
  const attachments: AgentDeliveryAttachment[] = [];
  const seen = new Set<string>();

  for (const [declaredKind, values] of [
    ["folder", folderPaths],
    ["file", filePaths],
  ] as const) {
    for (const value of values) {
      const resolved = resolveWorkspacePath(workspacePath, value);
      if (!resolved || seen.has(resolved.candidate.toLowerCase())) continue;
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(resolved.candidate);
      } catch {
        continue;
      }
      const kind =
        declaredKind === "folder" || stat.isDirectory()
          ? "folder"
          : isImagePath(resolved.candidate)
          ? "image"
          : "file";
      if (kind === "file" || kind === "image") {
        const insideFolder = attachments.some(
          (item) =>
            item.kind === "folder" &&
            resolved.candidate.startsWith(`${item.nativePath}${path.sep}`),
        );
        if (insideFolder) continue;
      }
      seen.add(resolved.candidate.toLowerCase());
      attachments.push({
        path: resolved.relative,
        nativePath: resolved.candidate,
        fileName: path.basename(resolved.candidate),
        kind,
        size: stat.isFile() ? stat.size : undefined,
      });
    }
  }

  const topLevelAttachments = attachments.filter(
    (item, index) =>
      !attachments.some(
        (parent, parentIndex) =>
          parentIndex !== index &&
          parent.kind === "folder" &&
          item.nativePath.startsWith(`${parent.nativePath}${path.sep}`),
      ),
  );

  return {
    text: stripOutputSections(rawText),
    attachments: topLevelAttachments,
  };
};

export const AGENT_DELIVERY_SYSTEM_PROMPT = [
  "The application can deliver your final text and workspace outputs to the bound OpenIM conversation.",
  "Do not claim that files or folders cannot be sent and do not ask the user to send them manually.",
  "When the user asks you to send a file or folder, create it in the workspace first.",
  "When you create files or folders that the user should receive in OpenIM,",
  "list workspace-relative paths at the end of your final response using these headings:",
  "## Output Files and ## Output Folders. Use one markdown list item per path.",
  "Do not send OpenIM messages yourself; the application applies the user's per-session delivery settings.",
].join("\n");
