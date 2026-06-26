import { expect, test } from "../fixtures/electronApp";
import { e2eAttachmentMessageIDs, e2eMessageIDs } from "../fixtures/mockOpenIM";
import { messageActionTrigger, messageItem } from "../helpers/selectors";
import { setupTerminalHarness } from "../helpers/terminal";
import { gotoHarness } from "../helpers/wait";

test("terminal dock smoke is available without a real runtime", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { terminal: true });

  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-run-profile")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-runtime-controls")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-im-agent-group")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-agent-im-group")).toBeVisible();
  await expect(
    appWindow
      .getByTestId("terminal-im-agent-group")
      .getByTestId("terminal-auto-inject-toggle"),
  ).toHaveCount(0);
  await expect(
    appWindow
      .getByTestId("terminal-agent-im-group")
      .getByTestId("terminal-auto-reply-toggle"),
  ).toHaveCount(0);
  await expect(appWindow.getByTestId("chat-agent-automation-bar")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-menu")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-send-last-context")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-reply-debug")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-opencode-probe")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-capture-final-answer")).toBeVisible();
});

test("unsafe automation defaults reset and debug controls stay hidden", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.evaluate(() => {
    const raw = window.localStorage.getItem("openim_terminal_dock_state");
    const parsed = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(
      "openim_terminal_dock_state",
      JSON.stringify({
        ...parsed,
        autoReceiveEnabled: true,
        autoSendEnabled: true,
        autoInjectEnabled: true,
        autoReplyEnabled: true,
      }),
    );
    window.location.reload();
  });

  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-auto-inject-toggle")).not.toBeChecked();
  await expect(appWindow.getByTestId("terminal-auto-reply-toggle")).not.toBeChecked();
  await expect(appWindow.getByTestId("chat-agent-automation-state")).toContainText(
    /off|needs linked running terminal/,
  );
});

test("auto-inject enabled without binding still creates pending request only", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Inject" }).click();

  await expect(
    appWindow
      .getByTestId("pending-agent-request")
      .filter({ hasText: "@bot @e2e_self summarize this conversation." }),
  ).toContainText("@bot @e2e_self summarize this conversation.");
  const writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain("botTrigger");
});

test("auto-reply off ignores structured final_answer", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  const workspaceID = await appWindow.evaluate(() =>
    (
      window as unknown as {
        __e2eGetActiveWorkspaceID?: () => string | undefined;
      }
    ).__e2eGetActiveWorkspaceID?.(),
  );
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  await appWindow.evaluate(
    ({ wid }) => {
      (
        window as unknown as {
          __e2eEmitStructuredEvent?: (
            workspaceID: string,
            event: Record<string, unknown>,
          ) => void;
        }
      ).__e2eEmitStructuredEvent?.(wid, {
        type: "final_answer",
        text: "This should not auto-send.",
        format: "text",
      });
    },
    { wid: workspaceID },
  );

  await expect(appWindow.getByTestId("e2e-draft-preview")).not.toContainText(
    "This should not auto-send.",
  );
  await expect(appWindow.getByTestId("e2e-sent-drafts")).not.toContainText(
    "This should not auto-send.",
  );
});

test("terminal context history can copy and send prompt", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();
  await appWindow.getByTestId("message-selection-copy-prompt").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toHaveCount(0);
  await appWindow.getByTestId("terminal-context-advanced").click();
  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "selectedMessages",
  );

  await appWindow.getByTestId("terminal-context-record-copy-prompt").first().click();
  await appWindow.getByTestId("terminal-context-record-send").first().click();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "context/",
  );
});

test("selected image attachment creates exported context paths", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eAttachmentMessageIDs.image)).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();
  await appWindow.getByTestId("message-selection-preview").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /attachments\/bundle_/,
  );
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /status: exported/,
  );
  await expect(appWindow.getByTestId("terminal-context-prompt-preview")).toHaveValue(
    /OpenIM source summary:/,
  );
  await expect(appWindow.getByTestId("terminal-context-prompt-preview")).toHaveValue(
    /Attachment status summary:/,
  );
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "1 attachments",
  );
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "1 exported",
  );

  const writes = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
        }
      ).__e2eWorkspaceWrites,
  );
  const manifestWrite = writes?.find((write) =>
    write.relativePath?.endsWith(".manifest.json"),
  );

  expect(manifestWrite?.content).toContain('"attachments"');
  expect(manifestWrite?.content).toContain('"sourceSummary"');
  expect(manifestWrite?.content).toContain('"attachmentStatusSummary"');
  expect(manifestWrite?.content).toContain('"attachmentExportState": "ready"');
  expect(manifestWrite?.content).toContain('"status": "exported"');
  expect(manifestWrite?.content).toContain("attachments/bundle_");
});

test("failed attachment export keeps bundle and terminal prompt", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow
    .locator(messageActionTrigger(e2eAttachmentMessageIDs.failedFile))
    .click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toHaveCount(0);
  await appWindow.getByTestId("terminal-context-advanced").click();
  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /status: failed/,
  );
  await expect(appWindow.getByTestId("terminal-context-prompt-preview")).toHaveValue(
    /Bundle state: degraded\./,
  );
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "1 failed",
  );

  const writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  const workspaceWrites = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
        }
      ).__e2eWorkspaceWrites,
  );
  const manifestWrite = workspaceWrites?.find((write) =>
    write.relativePath?.endsWith(".manifest.json"),
  );
  const requestWrite = workspaceWrites?.find((write) =>
    write.relativePath?.endsWith("/request.md"),
  );

  expect(writes?.join("\n")).toContain("Current run:");
  expect(writes?.join("\n")).toContain(".agent/runs/");
  expect(writes?.join("\n")).toContain("manifest");
  expect(requestWrite?.content).toContain("context/");
  expect(requestWrite?.content).toContain("manifest");
  expect(requestWrite?.content).toContain(
    "Check manifest status, error, and source fields",
  );
  expect(writes?.join("\n")).toContain("Do not send messages back to OpenIM yourself");
  expect(manifestWrite?.content).toContain('"attachments"');
  expect(manifestWrite?.content).toContain('"attachmentExportState": "degraded"');
  expect(manifestWrite?.content).toContain('"status": "failed"');
});

test("structured final answer capture prefers machine-readable output and only updates draft", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.locator(messageItem(e2eMessageIDs[1])).evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await appWindow.getByTestId("terminal-use-selection-reply").click();
  await expect(appWindow.getByTestId("terminal-selection-reply-review")).toBeVisible();
  await appWindow.getByTestId("terminal-selection-reply-confirm").click();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "reply from e2e peer",
  );
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toBeEmpty();

  await appWindow.waitForTimeout(1000);
  await appWindow.evaluate(() => {
    (
      window as unknown as { __e2eEmitTerminalOutput?: (text: string) => void }
    ).__e2eEmitTerminalOutput?.(
      [
        '{"type":"session.updated","session":{"id":"session_123"}}',
        '{"type":"assistant.final","text":"Structured final answer from opencode"}',
      ].join("\n"),
    );
  });
  await appWindow.getByTestId("terminal-capture-final-answer").click();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "Structured final answer from opencode",
  );
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toBeEmpty();
});

test("send to agent creates run-scoped final answer contract", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as {
                __e2eWorkspaceWrites?: Array<{
                  relativePath?: string;
                  content?: string;
                }>;
              }
            ).__e2eWorkspaceWrites?.some(
              (write) => write.relativePath === ".agent/skills/openim-final-answer.md",
            ) ?? false,
        ),
      { timeout: 5000 },
    )
    .toBeTruthy();

  const workspaceWrites = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
        }
      ).__e2eWorkspaceWrites ?? [],
  );
  const writes = await appWindow.evaluate(
    () =>
      (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites ??
      [],
  );

  const runRequest = workspaceWrites.find((write) =>
    /^\.agent\/runs\/run_.*\/request\.md$/.test(write.relativePath ?? ""),
  );
  const runManifest = workspaceWrites.find((write) =>
    /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
  );
  const latestRun = workspaceWrites.find(
    (write) => write.relativePath === ".agent/latest-run.json",
  );

  expect(
    workspaceWrites.some(
      (write) => write.relativePath === ".agent/skills/openim-final-answer.md",
    ),
  ).toBeTruthy();
  expect(
    workspaceWrites.some(
      (write) => write.relativePath === ".agent/skills/openim-context.md",
    ),
  ).toBeTruthy();
  expect(runRequest?.content).toContain("OpenIM Context Bundle");
  expect(runManifest?.content).toContain('"status": "pending"');
  expect(latestRun?.content).toContain('"finalAnswerPath"');
  expect(writes.join("\n")).toContain(".agent/skills/openim-final-answer.md");
  expect(writes.join("\n")).toContain(runRequest?.relativePath ?? "missing-run");
  expect(writes.join("\n")).toContain("overwrite");
});

test("agent prompt template can be edited without keeping prompt history", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.getByTestId("terminal-run-profile").click();
  await appWindow.getByRole("menuitem", { name: "Command Templates" }).click();
  await expect(
    appWindow.getByRole("dialog", { name: "Command Templates" }),
  ).toBeVisible();
  await appWindow.getByTestId("terminal-agent-prompt-template").fill(
    [
      "CUSTOM OPENIM RUN",
      "Read {requestPath}",
      "Write {finalAnswerPath}",
      "Update {manifestPath}",
    ].join("\n"),
  );
  await appWindow
    .getByRole("dialog", { name: "Command Templates" })
    .locator("button")
    .filter({ hasText: "Close" })
    .click();

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  const writes = await appWindow.evaluate(
    () =>
      (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites ??
      [],
  );

  expect(writes.join("\n")).toContain("CUSTOM OPENIM RUN");
  expect(writes.join("\n")).toContain(".agent/runs/");
  expect(writes.join("\n")).toContain("final_answer.md");
});

test("run-scoped final answer capture reads completed manifest", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as {
                __e2eWorkspaceWrites?: Array<{
                  relativePath?: string;
                  content?: string;
                }>;
              }
            ).__e2eWorkspaceWrites?.find((write) =>
              /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
            )?.content,
        ),
      { timeout: 5000 },
    )
    .toContain('"status": "pending"');

  const runManifestWrite = await appWindow.evaluate(() =>
    (
      window as unknown as {
        __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
      }
    ).__e2eWorkspaceWrites?.find((write) =>
      /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
    ),
  );
  expect(runManifestWrite?.content).toBeTruthy();
  const manifest = JSON.parse(runManifestWrite?.content ?? "{}") as {
    runID: string;
    requestPath: string;
    finalAnswerPath: string;
    updatedAt: number;
  };

  await appWindow.evaluate(
    ({ manifestPath, finalAnswerPath, manifest: baseManifest }) => {
      const writes =
        (
          window as unknown as {
            __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
          }
        ).__e2eWorkspaceWrites ?? [];
      writes.push({
        relativePath: finalAnswerPath,
        content: "Run file final answer from agent.",
      });
      writes.push({
        relativePath: manifestPath,
        content: JSON.stringify(
          {
            ...baseManifest,
            status: "completed",
            updatedAt: Date.now(),
          },
          null,
          2,
        ),
      });
    },
    {
      manifestPath: runManifestWrite?.relativePath,
      finalAnswerPath: manifest.finalAnswerPath,
      manifest,
    },
  );

  await appWindow.getByTestId("terminal-capture-final-answer").click();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "Run file final answer from agent.",
  );
});

test("auto-reply sends only the active run completed final answer", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await appWindow.evaluate(() => {
    (
      window as unknown as {
        __e2eLinkActiveConversationToWorkspace?: () => void;
      }
    ).__e2eLinkActiveConversationToWorkspace?.();
  });
  await appWindow.getByTestId("terminal-auto-reply-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Reply" }).click();

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as {
                __e2eWorkspaceWrites?: Array<{
                  relativePath?: string;
                  content?: string;
                }>;
              }
            ).__e2eWorkspaceWrites?.find((write) =>
              /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
            )?.content,
        ),
      { timeout: 5000 },
    )
    .toContain('"status": "pending"');

  const runManifestWrite = await appWindow.evaluate(() =>
    (
      window as unknown as {
        __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
      }
    ).__e2eWorkspaceWrites?.find((write) =>
      /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
    ),
  );
  const manifest = JSON.parse(runManifestWrite?.content ?? "{}") as {
    runID: string;
    requestPath: string;
    finalAnswerPath: string;
    updatedAt: number;
  };

  await appWindow.evaluate(
    ({ manifestPath, finalAnswerPath, manifest: baseManifest }) => {
      const writes =
        (
          window as unknown as {
            __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
          }
        ).__e2eWorkspaceWrites ?? [];
      writes.push({
        relativePath: ".agent/runs/run_old/final_answer.md",
        content: "Old run answer should not send.",
      });
      writes.push({
        relativePath: ".agent/runs/run_old/manifest.json",
        content: JSON.stringify(
          {
            ...baseManifest,
            runID: "run_old",
            finalAnswerPath: ".agent/runs/run_old/final_answer.md",
            status: "completed",
            updatedAt: Date.now(),
          },
          null,
          2,
        ),
      });
      writes.push({
        relativePath: finalAnswerPath,
        content: "Current run auto reply answer.",
      });
      writes.push({
        relativePath: manifestPath,
        content: JSON.stringify(
          {
            ...baseManifest,
            status: "completed",
            updatedAt: Date.now(),
          },
          null,
          2,
        ),
      });
    },
    {
      manifestPath: runManifestWrite?.relativePath,
      finalAnswerPath: manifest.finalAnswerPath,
      manifest,
    },
  );

  await expect(appWindow.getByTestId("e2e-sent-drafts")).toContainText(
    "Current run auto reply answer.",
    { timeout: 6000 },
  );
  await expect(appWindow.getByTestId("e2e-sent-drafts")).not.toContainText(
    "Old run answer should not send.",
  );
});

test("dangerous attachment is skipped by export policy without blocking bundle", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await appWindow
    .locator(messageActionTrigger(e2eAttachmentMessageIDs.dangerousFile))
    .click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();
  await appWindow.getByTestId("message-selection-preview").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /status: skipped/,
  );
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /auto-export blocked by policy/i,
  );
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "1 skipped",
  );

  const workspaceWrites = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{ relativePath?: string; content?: string }>;
        }
      ).__e2eWorkspaceWrites,
  );
  const exportCalls = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eAttachmentExportCalls?: Array<{
            channel: string;
            relativePath?: string;
          }>;
        }
      ).__e2eAttachmentExportCalls,
  );
  const manifestWrite = workspaceWrites?.find((write) =>
    write.relativePath?.endsWith(".manifest.json"),
  );

  expect(exportCalls?.length ?? 0).toBe(0);
  expect(manifestWrite?.content).toContain('"status": "skipped"');
  expect(manifestWrite?.content).toContain('"skippedAttachmentCount": 1');
  expect(manifestWrite?.content).toContain('"attachmentExportState": "partial"');
});

test("context library can attach a generated workspace file as pending draft attachment", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();
  await appWindow.getByTestId("message-selection-preview").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-workspace-file-input")).toHaveValue(
    /context\//,
  );
  await appWindow.getByTestId("terminal-workspace-file-attach").click();
  await expect(appWindow.getByTestId("e2e-pending-attachments")).toContainText(/\.md/);
  await expect(appWindow.getByTestId("e2e-pending-attachments")).toContainText(
    "context/",
  );
  await appWindow
    .getByRole("dialog", { name: "Context Files" })
    .getByLabel("Close", { exact: true })
    .click();
  await appWindow.getByTestId("chat-footer-remove-pending-attachment").click();
  await expect(appWindow.getByTestId("e2e-pending-attachments")).toBeEmpty();
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toBeEmpty();
});
