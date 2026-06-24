import { expect, test } from "../fixtures/electronApp";
import { e2eMessageIDs } from "../fixtures/mockOpenIM";
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
