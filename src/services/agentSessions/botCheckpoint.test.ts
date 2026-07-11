import assert from "node:assert/strict";

import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { splitHistoryPageAfterCheckpoint } from "./botCheckpoint";

const messages = ["old", "checkpoint", "new-1", "new-2"].map(
  (clientMsgID) => ({ clientMsgID } as MessageItem),
);

assert.deepEqual(
  splitHistoryPageAfterCheckpoint(messages, "checkpoint"),
  {
    messages: messages.slice(2),
    checkpointFound: true,
  },
  "only messages newer than the persisted checkpoint are routed",
);
assert.deepEqual(splitHistoryPageAfterCheckpoint(messages, "missing"), {
  messages,
  checkpointFound: false,
});
assert.deepEqual(splitHistoryPageAfterCheckpoint(messages), {
  messages,
  checkpointFound: false,
});

console.log("Bot checkpoint tests passed");
