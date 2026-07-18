const readline = require("node:readline");

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "agent.status") {
    process.stdout.write(
      `${JSON.stringify({
        protocolVersion: 1,
        timestamp: Date.now(),
        type: "event",
        event: "agent.presence",
        eventID: "presence-1",
        sequence: 0,
        sourceRuntimeID: "fixture",
        payload: { status: "online" },
      })}\n`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      protocolVersion: 1,
      timestamp: Date.now(),
      type: "res",
      id: request.id,
      ok: true,
      payload: {
        echoedMethod: request.method,
        idempotencyKey: request.idempotencyKey,
      },
    })}\n`,
  );
});
