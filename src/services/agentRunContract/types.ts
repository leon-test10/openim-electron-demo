export type AgentRunStatus = "pending" | "running" | "completed" | "failed";

export interface AgentRunContract {
  runID: string;
  workspaceID: string;
  conversationID: string;
  createdAt: number;
  runDir: string;
  requestPath: string;
  finalAnswerPath: string;
  manifestPath: string;
  skillPaths: {
    finalAnswer: string;
    context: string;
  };
}

export interface AgentRunManifest {
  runID: string;
  status: AgentRunStatus;
  requestPath: string;
  finalAnswerPath: string;
  updatedAt: number;
  error?: string;
}

export interface CreateAgentRunContractParams {
  workspaceID: string;
  conversationID: string;
  requestMarkdown: string;
  promptText: string;
  terminalPromptTemplate?: string;
  now?: number;
}

export interface AgentRunContractArtifacts {
  contract: AgentRunContract;
  requestMarkdown: string;
  initialManifest: AgentRunManifest;
  latestRun: AgentRunManifest & {
    manifestPath: string;
  };
  skillFiles: Array<{
    path: string;
    content: string;
  }>;
  terminalPrompt: string;
}
