export const MIN_AGENT_CONTEXT_MESSAGES = 1;
export const MAX_AGENT_CONTEXT_MESSAGES = 200;

export interface ContextPolicy {
  ownerUserID: string;
  recentMessageLimit: number;
  selectedMessageIDs?: string[];
  includeAttachments: boolean;
  allowedConversationIDs: string[];
}

export interface AgentRequest {
  requestID: string;
  conversationID: string;
  requesterUserID: string;
  targetAgentID: string;
  runtimeID?: string;
  instruction: string;
  contextPolicy: ContextPolicy;
  createdAt: number;
}

export interface AgentArtifact {
  artifactID: string;
  requestID: string;
  runID: string;
  type: "file" | "folder" | "image" | "text";
  name: string;
  localPath?: string;
  storageURL?: string;
  status: "staged" | "approved" | "published" | "failed";
}

export interface AgentStagedResult {
  resultID: string;
  requestID: string;
  runID: string;
  sessionID: string;
  messageID: string;
  status: "running" | "completed_staged" | "approved" | "published" | "rejected";
  finalAnswer: string;
  originalFinalAnswer: string;
  textPublished?: boolean;
  artifacts: AgentArtifact[];
  authorizedContextMessageCount: number;
  createdAt: number;
  updatedAt: number;
  publicationError?: string;
}

export interface AgentRunTraceSummary {
  traceID: string;
  requestID: string;
  runID: string;
  requesterUserID: string;
  runtimeID: string;
  startedAt: number;
  finishedAt?: number;
  status: string;
  retryCount: number;
  permissionCount: number;
  questionCount: number;
  artifactCount: number;
  humanTakeover: boolean;
  published: boolean;
  failureCode?: string;
}

export type ImprovementCandidateSource =
  | "runtime_error"
  | "repeated_retry"
  | "human_takeover"
  | "publication_failure"
  | "user_feedback";

export type ImprovementCandidateStatus =
  | "new"
  | "approved"
  | "rejected"
  | "converted_to_goal";

export interface ImprovementCandidate {
  candidateID: string;
  source: ImprovementCandidateSource;
  relatedTraceIDs: string[];
  title: string;
  description: string;
  status: ImprovementCandidateStatus;
  createdAt: number;
}

type IDFactory = (prefix: string) => string;

const defaultIDFactory: IDFactory = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const uniqueStrings = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

export const normalizeContextPolicy = (policy: ContextPolicy): ContextPolicy => {
  const ownerUserID = policy.ownerUserID.trim();
  if (!ownerUserID) throw new Error("Context policy owner is required");
  if (
    !Number.isInteger(policy.recentMessageLimit) ||
    policy.recentMessageLimit < MIN_AGENT_CONTEXT_MESSAGES ||
    policy.recentMessageLimit > MAX_AGENT_CONTEXT_MESSAGES
  ) {
    throw new Error(
      `Context message limit must be between ${MIN_AGENT_CONTEXT_MESSAGES} and ${MAX_AGENT_CONTEXT_MESSAGES}`,
    );
  }
  const allowedConversationIDs = uniqueStrings(policy.allowedConversationIDs);
  if (allowedConversationIDs.length === 0) {
    throw new Error("At least one authorized conversation is required");
  }
  const selectedMessageIDs = uniqueStrings(policy.selectedMessageIDs ?? []);
  return {
    ownerUserID,
    recentMessageLimit: policy.recentMessageLimit,
    selectedMessageIDs: selectedMessageIDs.length > 0 ? selectedMessageIDs : undefined,
    includeAttachments: policy.includeAttachments === true,
    allowedConversationIDs,
  };
};

export const createContextPolicy = (
  policy: Omit<ContextPolicy, "recentMessageLimit"> & {
    recentMessageLimit: number;
  },
): ContextPolicy =>
  normalizeContextPolicy({
    ...policy,
    recentMessageLimit: Math.min(
      Math.max(Math.round(policy.recentMessageLimit), MIN_AGENT_CONTEXT_MESSAGES),
      MAX_AGENT_CONTEXT_MESSAGES,
    ),
  });

export const createAgentRequest = (
  params: Omit<AgentRequest, "requestID" | "createdAt" | "contextPolicy"> & {
    requestID?: string;
    createdAt?: number;
    contextPolicy: ContextPolicy;
  },
  createID: IDFactory = defaultIDFactory,
): AgentRequest => {
  const conversationID = params.conversationID.trim();
  const requesterUserID = params.requesterUserID.trim();
  const targetAgentID = params.targetAgentID.trim();
  const instruction = params.instruction.trim();
  if (!conversationID) throw new Error("Agent request conversation is required");
  if (!requesterUserID) throw new Error("Agent requester is required");
  if (!targetAgentID) throw new Error("Target Agent is required");
  if (!instruction) throw new Error("Agent instruction is required");
  const contextPolicy = normalizeContextPolicy(params.contextPolicy);
  if (contextPolicy.ownerUserID !== requesterUserID) {
    throw new Error("Context policy must be owned by the requester");
  }
  if (!contextPolicy.allowedConversationIDs.includes(conversationID)) {
    throw new Error("Agent request conversation is not authorized");
  }
  return {
    requestID: params.requestID?.trim() || createID("agent_request"),
    conversationID,
    requesterUserID,
    targetAgentID,
    runtimeID: params.runtimeID?.trim() || undefined,
    instruction,
    contextPolicy,
    createdAt: params.createdAt ?? Date.now(),
  };
};

export const createRunTrace = (
  params: Pick<
    AgentRunTraceSummary,
    "requestID" | "runID" | "requesterUserID" | "runtimeID"
  > & { startedAt?: number },
  createID: IDFactory = defaultIDFactory,
): AgentRunTraceSummary => ({
  traceID: createID("agent_trace"),
  requestID: params.requestID,
  runID: params.runID,
  requesterUserID: params.requesterUserID,
  runtimeID: params.runtimeID,
  startedAt: params.startedAt ?? Date.now(),
  status: "queued",
  retryCount: 0,
  permissionCount: 0,
  questionCount: 0,
  artifactCount: 0,
  humanTakeover: false,
  published: false,
});

export const stageAgentResult = (
  params: {
    requestID: string;
    runID: string;
    sessionID: string;
    messageID: string;
    finalAnswer: string;
    authorizedContextMessageCount: number;
    artifacts: Array<{
      type: AgentStagedResult["artifacts"][number]["type"];
      name: string;
      localPath?: string;
      storageURL?: string;
    }>;
    createdAt?: number;
  },
  createID: IDFactory = defaultIDFactory,
): AgentStagedResult => {
  const now = params.createdAt ?? Date.now();
  return {
    resultID: createID("agent_result"),
    requestID: params.requestID,
    runID: params.runID,
    sessionID: params.sessionID,
    messageID: params.messageID,
    status: "completed_staged",
    finalAnswer: params.finalAnswer.trim(),
    originalFinalAnswer: params.finalAnswer.trim(),
    artifacts: params.artifacts.map((artifact) => ({
      artifactID: createID("agent_artifact"),
      requestID: params.requestID,
      runID: params.runID,
      type: artifact.type,
      name: artifact.name,
      localPath: artifact.localPath,
      storageURL: artifact.storageURL,
      status: "staged",
    })),
    authorizedContextMessageCount: params.authorizedContextMessageCount,
    createdAt: now,
    updatedAt: now,
  };
};

const sanitizeImprovementText = (value: string) =>
  value
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(
      /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED]",
    )
    .replace(/\bBearer\s+[a-zA-Z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .trim()
    .slice(0, 1000);

export const createImprovementCandidate = (
  params: {
    source: ImprovementCandidateSource;
    relatedTraceIDs: string[];
    title: string;
    description: string;
    createdAt?: number;
  },
  createID: IDFactory = defaultIDFactory,
): ImprovementCandidate => ({
  candidateID: createID("improvement"),
  source: params.source,
  relatedTraceIDs: uniqueStrings(params.relatedTraceIDs),
  title: sanitizeImprovementText(params.title).slice(0, 160),
  description: sanitizeImprovementText(params.description),
  status: "new",
  createdAt: params.createdAt ?? Date.now(),
});

export const updateImprovementCandidateStatus = (
  candidate: ImprovementCandidate,
  status: ImprovementCandidateStatus,
): ImprovementCandidate => ({ ...candidate, status });
