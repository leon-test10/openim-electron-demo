import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAgentDelivery } from "../electron/main/agentDelivery";
import type { AgentMessage } from "../src/types/agentSession";

const run = async () => {
  const workspace = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "openim-agent-delivery-"),
  );
  try {
    await fs.promises.mkdir(path.join(workspace, "output", "bundle"), {
      recursive: true,
    });
    await fs.promises.writeFile(path.join(workspace, "output", "report.md"), "ok");
    await fs.promises.writeFile(
      path.join(workspace, "output", "bundle", "inside.txt"),
      "ok",
    );
    const message: AgentMessage = {
      id: "assistant-1",
      sessionID: "runtime-1",
      role: "assistant",
      createdAt: Date.now(),
      completedAt: Date.now(),
      parts: [
        {
          id: "text-1",
          type: "text",
          text: [
            "任务已完成。",
            "",
            "## Output Files",
            "- output/report.md",
            "- output/bundle/inside.txt",
            "",
            "## Output Folders",
            "- output/bundle/",
          ].join("\n"),
        },
      ],
    };
    const result = await resolveAgentDelivery(workspace, message);
    assert.equal(result.text, "任务已完成。");
    assert.deepEqual(
      result.attachments.map((item) => [item.path, item.kind]),
      [
        ["output/bundle", "folder"],
        ["output/report.md", "file"],
      ],
    );
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
};

void run();
