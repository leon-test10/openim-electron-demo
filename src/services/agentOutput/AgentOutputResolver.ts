import type { AgentRunContract, AgentRunManifest } from "@/services/agentRunContract";

import type { AgentOutputEvent } from "./types";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_CONTROL_PATTERN = new RegExp(
  `${ANSI_ESCAPE}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|${ANSI_ESCAPE}\\\\)|[@-Z\\\\-_])`,
  "g",
);

export type AgentOutputSource =
  /** Reliable completed final_answer.md from the active run contract. */
  | "run_file"
  /** Reliable structured event from agent:structuredOutput IPC (Tier 1). */
  | "structured"
  /** Heuristic JSON scanning of raw PTY output (Tier 2). */
  | "structured_heuristic"
  /** Raw terminal output text (Tier 3). */
  | "raw"
  /** Visible xterm viewport text (Tier 4). */
  | "screen";

export interface AgentOutputResolution {
  text?: string;
  source: AgentOutputSource;
  sessionID?: string;
  runID?: string;
  /** Workspace-relative file paths extracted from ## Output Files section. */
  outputFiles?: string[];
  /** File mtime of manifest.json (milliseconds). */
  manifestFileMtimeMs?: number;
  /** File mtime of final_answer.md (milliseconds). */
  finalAnswerFileMtimeMs?: number;
  /** Status from the manifest. */
  manifestStatus?: "pending" | "running" | "completed" | "failed";
}

interface ResolveAgentOutputParams {
  visibleText?: string;
  recentOutputText?: string;
  storedOutputText?: string;
  /** Structured events received via the agent:structuredOutput IPC channel (Tier 1). */
  structuredEvents?: AgentOutputEvent[];
}

const isPathInsideRun = (runDir: string, path: string) =>
  path === runDir || path.startsWith(`${runDir}/`);

/** Extract workspace-relative file paths from ## Output Files section. */
const parseOutputFiles = (text: string): string[] | undefined => {
  const sectionMatch = text.match(
    /## Output Files\s*\n((?:[\s\S]*?))(?:\n## |\n---|\n```|$)/,
  );
  if (!sectionMatch) return undefined;

  const lines = sectionMatch[1].split("\n");
  const paths: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match markdown list items: "- path/to/file" or "* path/to/file"
    const match = trimmed.match(/^[-*]\s+(\S.+)$/);
    if (match?.[1]) {
      paths.push(match[1].trim());
    }
  }
  return paths.length > 0 ? paths : undefined;
};

export const resolveFromAgentRunContract = (
  contract: AgentRunContract | undefined,
  manifest: AgentRunManifest | undefined,
  finalAnswerText: string | undefined,
): AgentOutputResolution | undefined => {
  if (!contract || !manifest) return undefined;
  if (manifest.runID !== contract.runID) return undefined;
  if (manifest.status !== "completed") return undefined;
  if (manifest.updatedAt < contract.createdAt) return undefined;
  if (manifest.finalAnswerPath !== contract.finalAnswerPath) return undefined;
  if (!isPathInsideRun(contract.runDir, manifest.finalAnswerPath)) return undefined;

  const text = cleanText(finalAnswerText ?? "");
  if (!text) return undefined;

  return {
    text,
    source: "run_file",
    runID: contract.runID,
    outputFiles: parseOutputFiles(finalAnswerText ?? ""),
    manifestFileMtimeMs: manifest.updatedAt,
    finalAnswerFileMtimeMs: manifest.updatedAt,
    manifestStatus: manifest.status,
  };
};

const cleanText = (value: string) =>
  value
    .replace(ANSI_CONTROL_PATTERN, "")
    .replace(/\r/g, "\n")
    .replace(/\u2800/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+(\.\d+)?[KMG]?\s+\(\d+%\)\s+ctrl\+p\s+commands$/i.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = cleanText(value);
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractString(item))
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
    return text || undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const directKeys = ["text", "final", "finalText", "answer", "content", "markdown"];

  for (const key of directKeys) {
    const candidate = extractString(record[key]);
    if (candidate) return candidate;
  }

  if (record.message && typeof record.message === "object") {
    const candidate = extractString(record.message);
    if (candidate) return candidate;
  }

  if (record.delta && typeof record.delta === "object") {
    const candidate = extractString(record.delta);
    if (candidate) return candidate;
  }

  return undefined;
};

const parseStructuredObjects = (rawText: string) => {
  const events: Array<Record<string, unknown>> = [];

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) continue;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object") {
            events.push(item as Record<string, unknown>);
          }
        });
        continue;
      }

      if (parsed && typeof parsed === "object") {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  return events;
};

const resolveStructuredOutput = (
  rawText: string,
): AgentOutputResolution | undefined => {
  const events = parseStructuredObjects(rawText);
  if (events.length === 0) return undefined;

  let sessionID: string | undefined;

  for (const event of events) {
    const possibleSessionID =
      typeof event.sessionID === "string"
        ? event.sessionID
        : event.session &&
          typeof event.session === "object" &&
          typeof (event.session as Record<string, unknown>).id === "string"
        ? ((event.session as Record<string, unknown>).id as string)
        : undefined;

    if (possibleSessionID) {
      sessionID = possibleSessionID;
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    const shouldTreatAsFinal =
      type.includes("assistant.final") ||
      type.includes("final") ||
      type.includes("completed") ||
      type.includes("response.done");

    if (!shouldTreatAsFinal) continue;

    const text = extractString(event);
    if (text) {
      return {
        text,
        source: "structured_heuristic",
        sessionID,
      };
    }
  }

  return undefined;
};

/**
 * Tier 1: Resolve final answer from structured AgentOutputEvents received
 * via the agent:structuredOutput IPC channel.
 */
const resolveFromStructuredEvents = (
  events: AgentOutputEvent[],
): AgentOutputResolution | undefined => {
  let sessionID: string | undefined;

  // Collect session ID from session events
  for (const event of events) {
    if (event.type === "session" && event.id) {
      sessionID = event.id;
    }
  }

  // Find the last final_answer event (iterating backwards)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "final_answer" && event.text) {
      return {
        text: event.text,
        source: "structured",
        sessionID: event.sessionID ?? sessionID,
        runID: event.runID,
      };
    }
  }

  return undefined;
};

export const resolveAgentFinalAnswer = ({
  visibleText,
  recentOutputText,
  storedOutputText,
  structuredEvents,
}: ResolveAgentOutputParams): AgentOutputResolution | undefined => {
  // Tier 1: reliable structured events from IPC
  if (structuredEvents && structuredEvents.length > 0) {
    const fromEvents = resolveFromStructuredEvents(structuredEvents);
    if (fromEvents?.text) return fromEvents;
  }

  // Tier 2: heuristic JSON scanning of PTY output
  const rawText = [storedOutputText, recentOutputText]
    .filter((item): item is string => Boolean(item))
    .join("\n");

  const heuristic = rawText ? resolveStructuredOutput(rawText) : undefined;
  if (heuristic?.text) return heuristic;

  // Tier 3: raw terminal text
  const normalizedRaw = recentOutputText?.trim() || storedOutputText?.trim();
  if (normalizedRaw) {
    return {
      text: normalizedRaw,
      source: "raw",
      sessionID: heuristic?.sessionID,
    };
  }

  // Tier 4: visible xterm viewport text (last resort)
  const normalizedScreen = visibleText?.trim();
  if (normalizedScreen) {
    return {
      text: normalizedScreen,
      source: "screen",
      sessionID: heuristic?.sessionID,
    };
  }

  return undefined;
};
