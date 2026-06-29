/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");

const { AgentRunContractService } = require("./AgentRunContractService");

const artifacts = AgentRunContractService.create({
  workspaceID: "workspace-1",
  conversationID: "conversation-1",
  promptText: "Create a report",
  requestMarkdown: "No extra context",
  now: 1_725_000_000_000,
});

const finalAnswerSkill = artifacts.skillFiles.find((file: { path: string }) =>
  file.path.endsWith("openim-final-answer.md"),
).content;

assert.match(
  finalAnswerSkill,
  /final_answer\.md body must be the complete user-readable reply that is ready to send to the IM user/i,
);
assert.match(finalAnswerSkill, /Do not write debug notes/i);
assert.match(finalAnswerSkill, /Do not create a separate terminal summary/i);
assert.match(finalAnswerSkill, /Final reply has been written to final_answer\.md/i);
assert.match(finalAnswerSkill, /## Output Files/i);
assert.match(finalAnswerSkill, /## Output Folders/i);
assert.match(finalAnswerSkill, /Do not also list that directory's child files/i);
assert.match(finalAnswerSkill, /Output Folders takes priority/i);

console.log("AgentRunContractService tests passed");

export {};
