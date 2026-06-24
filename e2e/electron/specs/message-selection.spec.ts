import { expect, test } from "../fixtures/electronApp";
import { e2eMessageIDs } from "../fixtures/mockOpenIM";
import {
  messageActionHost,
  messageActionTrigger,
  messageItem,
} from "../helpers/selectors";
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

test("selected toolbar nests agent actions under More", async ({ appWindow }) => {
  await waitForHarness(appWindow);

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();

  await expect(appWindow.getByTestId("message-selection-copy")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-export-md")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-more")).toBeVisible();
  await expect(appWindow.getByTestId("message-selection-clear")).toBeVisible();
  await expect(
    appWindow.getByTestId("message-selection-agent-create-context"),
  ).toHaveCount(0);

  await appWindow.getByTestId("message-selection-more").click();
  await appWindow.getByTestId("message-selection-agent-menu").hover();
  await expect(
    appWindow.getByTestId("message-selection-agent-create-context"),
  ).toBeVisible();
  await expect(
    appWindow.getByTestId("message-selection-agent-copy-prompt"),
  ).toBeVisible();
  await expect(
    appWindow.getByTestId("message-selection-agent-send-terminal"),
  ).toBeVisible();
});
