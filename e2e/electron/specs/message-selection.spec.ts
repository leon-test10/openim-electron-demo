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

test("selected toolbar keeps IM-native actions in the primary row", async ({
  appWindow,
}) => {
  await waitForHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();

  await expect(appWindow.getByTestId("message-selection-copy")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-forward")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-send")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-more")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-clear")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-preview")).toHaveCount(0);
  await expect(appWindow.getByTestId("message-selection-copy-prompt")).toHaveCount(0);
  await expect(appWindow.getByTestId("message-selection-export-md")).toHaveCount(0);

  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();

  await expect(appWindow.getByTestId("message-selection-preview")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-copy-prompt")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-export-md")).toBeVisible();
});

test("selected messages create neutral IM context", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();

  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-advanced-menu").click();
  await appWindow.getByTestId("message-selection-preview").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "selectedMessages",
  );
});

test("message action menu keeps agent actions under more and advanced", async ({
  appWindow,
}) => {
  await waitForHarness(appWindow);

  await appWindow.locator(messageActionHost(e2eMessageIDs[0])).click({
    button: "right",
  });

  await expect(appWindow.getByTestId("message-action-reply")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-copy")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-forward")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-select")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-more-menu")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-send-to-agent")).toHaveCount(0);
  await expect(appWindow.getByTestId("message-action-preview-context")).toHaveCount(0);

  await appWindow.getByTestId("message-action-more-menu").click();
  await expect(appWindow.getByTestId("message-action-send-to-agent")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-advanced-menu")).toBeVisible();

  await appWindow.getByTestId("message-action-advanced-menu").click();
  await expect(appWindow.getByTestId("message-action-preview-context")).toBeVisible();
  await expect(appWindow.getByTestId("message-action-copy-prompt")).toBeVisible();
});
