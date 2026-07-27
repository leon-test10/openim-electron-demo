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

    await fs.promises.writeFile(
      path.join(workspace, "tool-created.txt"),
      "created by tool",
    );
    const toolMessage: AgentMessage = {
      id: "assistant-tool",
      sessionID: "runtime-1",
      role: "assistant",
      createdAt: Date.now(),
      completedAt: Date.now(),
      parts: [
        {
          id: "tool-write",
          type: "tool",
          name: "write",
          status: "completed",
          text: "Wrote file successfully.",
          metadata: {
            state: {
              status: "completed",
              input: { filePath: path.join(workspace, "tool-created.txt") },
            },
          },
        },
      ],
    };
    const finalMessage: AgentMessage = {
      id: "assistant-final",
      sessionID: "runtime-1",
      role: "assistant",
      createdAt: Date.now(),
      completedAt: Date.now(),
      parts: [{ id: "final-text", type: "text", text: "文件已经创建完成。" }],
    };
    const toolResult = await resolveAgentDelivery(workspace, [
      toolMessage,
      finalMessage,
    ]);
    assert.equal(toolResult.text, "文件已经创建完成。");
    assert.deepEqual(
      toolResult.attachments.map((item) => [item.path, item.kind]),
      [["tool-created.txt", "file"]],
    );

    await fs.promises.mkdir(path.join(workspace, "test-folder"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(workspace, "test-folder", "readme.txt"),
      "inside folder",
    );
    const folderResult = await resolveAgentDelivery(workspace, [
      {
        ...toolMessage,
        id: "assistant-folder-tool",
        parts: [
          {
            id: "tool-folder-write",
            type: "tool",
            name: "write",
            status: "completed",
            metadata: {
              state: {
                input: {
                  filePath: path.join(workspace, "test-folder", "readme.txt"),
                },
              },
            },
          },
        ],
      },
      {
        ...finalMessage,
        id: "assistant-folder-final",
        parts: [
          {
            id: "folder-final-text",
            type: "text",
            text: "Folder created: `test-folder/`",
          },
        ],
      },
    ]);
    assert.deepEqual(
      folderResult.attachments.map((item) => [item.path, item.kind]),
      [["test-folder", "folder"]],
    );

    await fs.promises.writeFile(path.join(workspace, "preview.png"), "png");
    await fs.promises.mkdir(path.join(workspace, "empty-folder"));
    const typedArtifacts = await resolveAgentDelivery(workspace, {
      ...finalMessage,
      id: "assistant-artifact-types",
      parts: [
        {
          id: "artifact-types-text",
          type: "text",
          text: [
            "Artifacts ready.",
            "",
            "## Output Files",
            "- preview.png",
            "",
            "## Output Folders",
            "- empty-folder/",
          ].join("\n"),
        },
      ],
    });
    assert.deepEqual(
      typedArtifacts.attachments.map((item) => [item.path, item.kind]),
      [
        ["empty-folder", "folder"],
        ["preview.png", "image"],
      ],
    );
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
};

void run();
