import assert from "node:assert/strict";
import http from "node:http";

import {
  parseOpenCodeSSEBlock,
  requestOpenCodeJSON,
} from "../electron/main/opencodeHttp";

const requests: Array<{ method?: string; url?: string; body: string }> = [];
const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    requests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    if (request.url?.startsWith("/session?") && request.method === "POST") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end('{"id":"ses_fake"}');
      return;
    }
    if (request.url?.includes("prompt_async")) {
      response.writeHead(204).end();
      return;
    }
    if (request.url?.includes("/message")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end("[]");
      return;
    }
    response.writeHead(500).end("fake failure");
  });
});

const run = async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestOpenCodeJSON(
      baseUrl,
      "/session?directory=C%3A%2Fwork",
      { method: "POST", body: JSON.stringify({ title: "fake" }) },
    );
    assert.deepEqual(created, { id: "ses_fake" });
    await requestOpenCodeJSON(
      baseUrl,
      "/session/ses_fake/prompt_async?directory=C%3A%2Fwork",
      {
        method: "POST",
        body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
      },
    );
    assert.match(requests[1].body, /"hello"/);
    assert.deepEqual(
      await requestOpenCodeJSON(
        baseUrl,
        "/session/ses_fake/message?directory=C%3A%2Fwork",
      ),
      [],
    );
    await assert.rejects(
      () => requestOpenCodeJSON(baseUrl, "/failure"),
      /fake failure/,
    );
    assert.deepEqual(
      parseOpenCodeSSEBlock(
        'event: message\ndata: {"directory":"C:/work","payload":{"type":"session.idle","properties":{"sessionID":"ses_fake"}}}',
      ),
      {
        directory: "C:/work",
        payload: { type: "session.idle", properties: { sessionID: "ses_fake" } },
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("OpenCode HTTP/SSE contract tests passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
