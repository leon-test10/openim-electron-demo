import assert from "node:assert/strict";

import {
  AgentHttpProtocolClient,
  OPENIM_AGENT_PROTOCOL_VERSION,
} from "../src/agent-core";

let eventPolls = 0;
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/v1/requests")) {
    const request = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: "res",
        id: request.id,
        ok: true,
        payload: {
          method: request.method,
          idempotencyKey: request.idempotencyKey,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  eventPolls += 1;
  return new Response(
    JSON.stringify(
      eventPolls === 1
        ? [
            {
              protocolVersion: OPENIM_AGENT_PROTOCOL_VERSION,
              timestamp: Date.now(),
              type: "event",
              event: "agent.presence",
              eventID: "presence-1",
              sequence: 0,
              payload: { status: "online" },
            },
          ]
        : [],
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for HTTP event");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const run = async () => {
  const client = new AgentHttpProtocolClient("https://agent.example/", {
    fetch: fetcher,
    pollIntervalMs: 5,
  });
  const events: string[] = [];
  const unsubscribe = client.subscribe((event) => events.push(event.eventID));

  const payload = await client.request(
    "agent.status",
    {},
    { idempotencyKey: "status-1" },
  );
  assert.deepEqual(payload, {
    method: "agent.status",
    idempotencyKey: "status-1",
  });
  await waitFor(() => events.length === 1);
  assert.deepEqual(events, ["presence-1"]);

  unsubscribe();
  client.close();
  console.log("Agent HTTP protocol client contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
