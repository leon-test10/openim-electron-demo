import assert from "node:assert/strict";

import type { AgentRequest } from "../../types/humanAgentCollaboration";
import {
  applyContextAttachmentPolicy,
  approveStagedResult,
  attachAgentRequestEnvelope,
  completeStagedPublication,
  createAgentRequest,
  createContextPolicy,
  createImprovementCandidate,
  deriveConversationAgentBindingState,
  editStagedResult,
  failStagedPublication,
  hasAgentRequestEnvelope,
  readAgentRequestEnvelope,
  removeStagedArtifact,
  selectAuthorizedContextMessages,
  stageAgentResult,
  updateImprovementCandidateStatus,
} from "./HumanAgentCollaborationService";

let sequence = 0;
const createID = (prefix: string) => `${prefix}_${++sequence}`;

const request = (
  recentMessageLimit: number,
  selectedMessageIDs?: string[],
): AgentRequest =>
  createAgentRequest(
    {
      conversationID: "conversation-a",
      requesterUserID: "requester-a",
      targetAgentID: "agent-b",
      instruction: "prepare a result",
      contextPolicy: createContextPolicy({
        ownerUserID: "requester-a",
        recentMessageLimit,
        selectedMessageIDs,
        includeAttachments: true,
        allowedConversationIDs: ["conversation-a"],
      }),
    },
    createID,
  );

const messages = Array.from({ length: 60 }, (_, index) => ({
  messageID: `message-${index + 1}`,
  conversationID: "conversation-a",
}));

const requesterTen = selectAuthorizedContextMessages(request(10), messages);
assert.equal(requesterTen.length, 10);
assert.equal(requesterTen[0].messageID, "message-51");

// A target-side local preference of 50 is deliberately not an input.
const targetLocalFifty = 50;
assert.equal(targetLocalFifty, 50);
assert.equal(selectAuthorizedContextMessages(request(10), messages).length, 10);

// A target-side local preference of 10 cannot reduce the requester's 50.
const targetLocalTen = 10;
assert.equal(targetLocalTen, 10);
assert.equal(selectAuthorizedContextMessages(request(50), messages).length, 50);

const selected = selectAuthorizedContextMessages(
  request(50, ["message-3", "message-1"]),
  messages,
);
assert.deepEqual(
  selected.map((message) => message.messageID),
  ["message-3", "message-1"],
);

assert.throws(
  () =>
    selectAuthorizedContextMessages(request(10), [
      ...messages,
      { messageID: "foreign", conversationID: "conversation-b" },
    ]),
  /unauthorized conversation/,
);

const transportedRequest = request(10);
assert.deepEqual(
  readAgentRequestEnvelope(
    attachAgentRequestEnvelope('{"preserved":true}', transportedRequest),
  ),
  transportedRequest,
);
assert.equal(
  hasAgentRequestEnvelope(
    attachAgentRequestEnvelope('{"preserved":true}', transportedRequest),
  ),
  true,
);
assert.equal(hasAgentRequestEnvelope('{"unrelated":true}'), false);
const tamperedEnvelope = JSON.parse(
  attachAgentRequestEnvelope("{}", transportedRequest),
) as Record<string, unknown>;
const tamperedRequest = structuredClone(transportedRequest);
tamperedRequest.conversationID = "conversation-b";
tamperedEnvelope.openimAgentRequest = {
  schema: "openim-agent.request.v1",
  request: tamperedRequest,
};
const tamperedEnvelopeText = JSON.stringify(tamperedEnvelope);
assert.equal(hasAgentRequestEnvelope(tamperedEnvelopeText), true);
assert.equal(readAgentRequestEnvelope(tamperedEnvelopeText), undefined);

assert.throws(
  () =>
    createAgentRequest({
      conversationID: "conversation-b",
      requesterUserID: "requester-a",
      targetAgentID: "agent-b",
      instruction: "not allowed",
      contextPolicy: createContextPolicy({
        ownerUserID: "requester-a",
        recentMessageLimit: 10,
        includeAttachments: false,
        allowedConversationIDs: ["conversation-a"],
      }),
    }),
  /not authorized/,
);

const attachmentMessages = [
  {
    messageID: "attachment-message",
    pictureElem: { sourcePath: "private.png" },
    fileElem: { filePath: "private.txt" },
    untouched: "metadata",
  },
];
assert.equal(
  applyContextAttachmentPolicy(attachmentMessages, false)[0].pictureElem,
  undefined,
);
assert.equal(
  applyContextAttachmentPolicy(attachmentMessages, false)[0].fileElem,
  undefined,
);
assert.equal(
  applyContextAttachmentPolicy(attachmentMessages, false)[0].untouched,
  "metadata",
);
assert.deepEqual(
  applyContextAttachmentPolicy(attachmentMessages, true),
  attachmentMessages,
);

assert.equal(
  deriveConversationAgentBindingState({
    hasBoundSession: true,
    imOnline: false,
    runtimeStatus: "idle",
  }),
  "im_offline",
);
assert.equal(
  deriveConversationAgentBindingState({
    hasBoundSession: true,
    imOnline: true,
    runtimeStatus: "disconnected",
  }),
  "runtime_disconnected",
);
assert.equal(
  deriveConversationAgentBindingState({
    hasBoundSession: false,
    imOnline: true,
  }),
  "unbound",
);

const staged = stageAgentResult(
  {
    requestID: "request-1",
    runID: "run-1",
    sessionID: "session-1",
    messageID: "message-final",
    finalAnswer: "Initial answer",
    authorizedContextMessageCount: 10,
    artifacts: [
      { type: "file", name: "report.md", localPath: "output/report.md" },
      { type: "folder", name: "bundle", localPath: "output/bundle" },
    ],
    createdAt: 100,
  },
  createID,
);
assert.equal(staged.status, "completed_staged");
assert.equal(staged.artifacts.length, 2);
assert.equal(staged.authorizedContextMessageCount, 10);
const edited = editStagedResult(staged, "Human edited answer", 110);
assert.equal(edited.finalAnswer, "Human edited answer");
const withoutFile = removeStagedArtifact(edited, edited.artifacts[0].artifactID, 120);
assert.equal(withoutFile.artifacts.length, 1);
const approved = approveStagedResult(withoutFile, 130);
assert.equal(approved.status, "approved");
assert.equal(approved.artifacts[0].status, "approved");
const failedPublication = failStagedPublication(approved, 140);
assert.equal(failedPublication.status, "completed_staged");
assert.match(failedPublication.publicationError ?? "", /kept for retry/);
const retryApproved = approveStagedResult(failedPublication, 145);
assert.equal(retryApproved.status, "approved");
assert.equal(retryApproved.publicationError, undefined);
assert.equal(completeStagedPublication(retryApproved, 149).status, "published");
const published = completeStagedPublication(approved, 150);
assert.equal(published.status, "published");
assert.equal(published.artifacts[0].status, "published");

const candidate = createImprovementCandidate(
  {
    source: "runtime_error",
    relatedTraceIDs: ["trace-1"],
    title: "Runtime failed",
    description:
      "api_key=super-secret-value Authorization: Bearer token-value sk-1234567890",
    createdAt: 200,
  },
  createID,
);
assert.equal(candidate.description.includes("super-secret-value"), false);
assert.equal(candidate.description.includes("token-value"), false);
assert.equal(candidate.description.includes("sk-1234567890"), false);
assert.equal(
  updateImprovementCandidateStatus(candidate, "approved").status,
  "approved",
);
