import { expect, test } from "../fixtures/electronApp";
import { e2eMessageIDs } from "../fixtures/mockOpenIM";
import {
  messageActionHost,
  messageActionTrigger,
  messageItem,
} from "../helpers/selectors";
import { setupTerminalHarness } from "../helpers/terminal";
import { waitForHarness } from "../helpers/wait";

test("header selection flow uses IM-native toolbar", async ({ appWindow }) => {
  await waitForHarness(appWindow);

  await appWindow.getByTestId("chat-header-more").click();
  await appWindow.getByTestId("chat-header-select-messages").click();

  await expect(appWindow.getByTestId("message-selection-toolbar")).toBeVisible();
  await expect(appWindow.getByTestId("floating-select-messages")).toHaveCount(0);

  await appWindow.locator(messageItem(e2eMessageIDs[0])).click();
  await appWindow.locator(messageItem(e2eMessageIDs[1])).click();
  await expect(appWindow.getByTestId("message-selection-count")).toContainText("2");

  await appWindow.getByTestId("message-selection-clear").click();
  await expect(appWindow.getByTestId("message-selection-toolbar")).toHaveCount(0);
});

test("message right-click can start selection mode", async ({ appWindow }) => {
  await waitForHarness(appWindow);

  await appWindow.locator(messageActionHost(e2eMessageIDs[0])).click({
    button: "right",
  });
  await appWindow.getByTestId("message-action-select").click();

  await expect(appWindow.getByTestId("message-selection-toolbar")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-count")).toContainText("1");

  await appWindow.locator(messageItem(e2eMessageIDs[1])).click();
  await expect(appWindow.getByTestId("message-selection-count")).toContainText("2");
});

test("selected toolbar exposes direct preview, copy, and send actions", async ({
  appWindow,
}) => {
  await waitForHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();

  await expect(appWindow.getByTestId("message-selection-copy")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-export-md")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-preview")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-copy-prompt")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-send")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-clear")).toBeVisible();
});

test("selected messages create neutral IM context", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();

  await appWindow.getByTestId("message-selection-preview").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "selectedMessages",
  );
});
