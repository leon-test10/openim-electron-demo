import { expect, test } from "../fixtures/electronApp";
import { e2eAttachmentMessageIDs, e2eMessageIDs } from "../fixtures/mockOpenIM";
import { messageActionTrigger } from "../helpers/selectors";
import { setupTerminalHarness } from "../helpers/terminal";
import { gotoHarness } from "../helpers/wait";

test("terminal dock smoke is available without a real runtime", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { terminal: true });

  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-run-profile")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-output-draft-toggle")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-draft-chat-toggle")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("terminal context history can copy and send prompt", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-agent-menu").hover();
  await appWindow.getByTestId("message-selection-agent-copy-prompt").click();

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
  await appWindow.getByTestId("message-selection-agent-menu").hover();
  await appWindow.getByTestId("message-selection-agent-create-context").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /attachments\/bundle_/,
  );
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /status: exported/,
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
  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-agent-menu").hover();
  await appWindow.getByTestId("message-selection-agent-send-terminal").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-markdown-preview")).toHaveValue(
    /status: failed/,
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
  expect(writes?.join("\n")).toContain("Some attachments could not be exported");
  expect(manifestWrite?.content).toContain('"attachments"');
  expect(manifestWrite?.content).toContain('"status": "failed"');
});
