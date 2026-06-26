import dayjs from "dayjs";

import {
  AgentRunContract,
  AgentRunContractArtifacts,
  AgentRunManifest,
  CreateAgentRunContractParams,
} from "./types";

const FINAL_ANSWER_SKILL_PATH = ".agent/skills/openim-final-answer.md";
const CONTEXT_SKILL_PATH = ".agent/skills/openim-context.md";
const LATEST_RUN_PATH = ".agent/latest-run.json";

export const DEFAULT_AGENT_TERMINAL_PROMPT_TEMPLATE = [
  "Use the OpenIM skill:",
  "{finalAnswerSkill}",
  "",
  "Current run:",
  "{runDir}/",
  "",
  "Read:",
  "{requestPath}",
  "",
  "When finished, overwrite:",
  "{finalAnswerPath}",
  "",
  "Then update:",
  "{manifestPath}",
  "",
  "Important:",
  "- Do not append to final_answer.md.",
  "- Do not write this result to any other run directory.",
  "- Do not send messages back to OpenIM yourself.",
].join("\n");

const normalizeRunIDSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);

const createRunID = (now: number) => {
  const stamp = dayjs(now).format("YYYYMMDD_HHmmss_SSS");
  const suffix = Math.random().toString(36).slice(2, 8);
  return normalizeRunIDSegment(`run_${stamp}_${suffix}`);
};

const createInitialManifest = (contract: AgentRunContract): AgentRunManifest => ({
  runID: contract.runID,
  status: "pending",
  requestPath: contract.requestPath,
  finalAnswerPath: contract.finalAnswerPath,
  updatedAt: contract.createdAt,
});

const buildFinalAnswerSkill = () =>
  [
    "# OpenIM Final Answer Skill",
    "",
    "You are running inside an OpenIM-managed workspace.",
    "",
    "For the current request, write the final answer only to the run directory named in the prompt.",
    "",
    "Rules:",
    "- Read the current run request.md before answering.",
    "- Create or overwrite final_answer.md. Do not append.",
    "- Do not write this request's final answer into any other run directory.",
    "- Do not send messages back to OpenIM yourself.",
    "- After writing final_answer.md, overwrite manifest.json with status completed.",
    "- If the task fails, overwrite manifest.json with status failed and an error string.",
    "",
    "Completed manifest shape:",
    "```json",
    '{ "runID": "<runID>", "status": "completed", "requestPath": ".agent/runs/<runID>/request.md", "finalAnswerPath": ".agent/runs/<runID>/final_answer.md", "updatedAt": 0 }',
    "```",
  ].join("\n");

const buildContextSkill = () =>
  [
    "# OpenIM Context Skill",
    "",
    "OpenIM context files are workspace-relative markdown and JSON manifest files.",
    "",
    "Read the context paths listed in the current run request.md.",
    "When attachments are present, inspect the manifest status before reading attachment files.",
    "Use workspace-relative paths exactly as written.",
  ].join("\n");

const buildRunRequestMarkdown = (params: CreateAgentRunContractParams) =>
  [
    "# OpenIM Agent Run Request",
    "",
    `Workspace ID: ${params.workspaceID}`,
    `Conversation ID: ${params.conversationID}`,
    `Created At: ${dayjs(params.now ?? Date.now()).format("YYYY-MM-DD HH:mm:ss")}`,
    "",
    "## Context Prompt",
    "",
    params.promptText,
    "",
    "## Exported Context",
    "",
    params.requestMarkdown,
    "",
    "## Output Contract",
    "",
    "Use the OpenIM final answer skill and write the final answer for this run only.",
    "Do not append to final_answer.md; overwrite it with the final answer for this run.",
    "After writing final_answer.md, overwrite manifest.json with status completed.",
  ].join("\n");

const renderTerminalPrompt = (
  contract: AgentRunContract,
  template = DEFAULT_AGENT_TERMINAL_PROMPT_TEMPLATE,
) => {
  const safeTemplate = template.trim()
    ? template
    : DEFAULT_AGENT_TERMINAL_PROMPT_TEMPLATE;

  return safeTemplate
    .replaceAll("{finalAnswerSkill}", contract.skillPaths.finalAnswer)
    .replaceAll("{contextSkill}", contract.skillPaths.context)
    .replaceAll("{runID}", contract.runID)
    .replaceAll("{runDir}", contract.runDir)
    .replaceAll("{requestPath}", contract.requestPath)
    .replaceAll("{finalAnswerPath}", contract.finalAnswerPath)
    .replaceAll("{manifestPath}", contract.manifestPath);
};

export const AgentRunContractService = {
  create(params: CreateAgentRunContractParams): AgentRunContractArtifacts {
    const createdAt = params.now ?? Date.now();
    const runID = createRunID(createdAt);
    const runDir = `.agent/runs/${runID}`;
    const contract: AgentRunContract = {
      runID,
      workspaceID: params.workspaceID,
      conversationID: params.conversationID,
      createdAt,
      runDir,
      requestPath: `${runDir}/request.md`,
      finalAnswerPath: `${runDir}/final_answer.md`,
      manifestPath: `${runDir}/manifest.json`,
      skillPaths: {
        finalAnswer: FINAL_ANSWER_SKILL_PATH,
        context: CONTEXT_SKILL_PATH,
      },
    };
    const initialManifest = createInitialManifest(contract);

    return {
      contract,
      requestMarkdown: buildRunRequestMarkdown(params),
      initialManifest,
      latestRun: {
        ...initialManifest,
        manifestPath: contract.manifestPath,
      },
      skillFiles: [
        {
          path: FINAL_ANSWER_SKILL_PATH,
          content: buildFinalAnswerSkill(),
        },
        {
          path: CONTEXT_SKILL_PATH,
          content: buildContextSkill(),
        },
      ],
      terminalPrompt: renderTerminalPrompt(contract, params.terminalPromptTemplate),
    };
  },

  parseManifest(value: string): AgentRunManifest | undefined {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object") return undefined;
      const record = parsed as Record<string, unknown>;
      if (typeof record.runID !== "string") return undefined;
      if (
        record.status !== "pending" &&
        record.status !== "running" &&
        record.status !== "completed" &&
        record.status !== "failed"
      ) {
        return undefined;
      }
      if (typeof record.requestPath !== "string") return undefined;
      if (typeof record.finalAnswerPath !== "string") return undefined;
      if (typeof record.updatedAt !== "number") return undefined;

      return {
        runID: record.runID,
        status: record.status,
        requestPath: record.requestPath,
        finalAnswerPath: record.finalAnswerPath,
        updatedAt: record.updatedAt,
        error: typeof record.error === "string" ? record.error : undefined,
      };
    } catch {
      return undefined;
    }
  },

  latestRunPath: LATEST_RUN_PATH,
};
