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
  await expect(appWindow.getByTestId("terminal-context-menu")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-send-last-context")).toHaveCount(0);
  await expect(appWindow.getByTestId("terminal-reply-debug")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-reply-debug")).toBeDisabled();
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

  expect(writes?.join("\n")).toContain("context/");
  expect(writes?.join("\n")).toContain("manifest");
  expect(writes?.join("\n")).toContain(
    "Check manifest status, error, and source fields",
  );
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
  await appWindow.getByTestId("terminal-reply-debug").click();
  await appWindow.getByTestId("terminal-capture-final-answer").click();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "Structured final answer from opencode",
  );
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toBeEmpty();
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
    .getByRole("dialog", { name: "Advanced / Debug Context Files" })
    .getByLabel("Close", { exact: true })
    .click();
  await appWindow.getByTestId("chat-footer-remove-pending-attachment").click();
  await expect(appWindow.getByTestId("e2e-pending-attachments")).toBeEmpty();
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toBeEmpty();
});
