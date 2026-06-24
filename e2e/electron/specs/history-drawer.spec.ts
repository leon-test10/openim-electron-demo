import { expect, test } from "../fixtures/electronApp";
import { setupTerminalHarness } from "../helpers/terminal";
import { waitForHarness } from "../helpers/wait";

test("history drawer is reachable from header menu", async ({ appWindow }) => {
  await waitForHarness(appWindow);

  await appWindow.getByTestId("chat-header-more").click();
  await appWindow.getByTestId("chat-header-history").click();

  await expect(appWindow.getByTestId("history-drawer")).toBeVisible();
  await appWindow.getByTestId("history-recent-50").click();
  await appWindow.getByTestId("history-load-more").click();
  await appWindow.getByTestId("history-select-visible").click();
  await expect(appWindow.getByTestId("message-selection-count")).toContainText("3");

  await appWindow.getByTestId("history-search-input").fill("searchable");
  await appWindow.getByTestId("history-apply-filter").click();
  await expect(appWindow.getByText("Search results: 1")).toBeVisible();
});

test("history selection creates neutral IM context", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow);

  await appWindow.getByTestId("chat-header-more").click();
  await appWindow.getByTestId("chat-header-history").click();
  await appWindow.getByTestId("history-select-visible").click();
  await appWindow.getByTestId("history-create-context").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "historyMessages",
  );
});

test("search result selection creates neutral IM context", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow);

  await appWindow.getByTestId("chat-header-more").click();
  await appWindow.getByTestId("chat-header-history").click();
  await appWindow.getByTestId("history-search-input").fill("searchable");
  await appWindow.getByTestId("history-apply-filter").click();
  await expect(appWindow.getByText("Search results: 1")).toBeVisible();
  await appWindow
    .getByTestId("history-drawer")
    .getByText("searchable history message")
    .click();
  await appWindow.getByTestId("history-create-context").click();

  await expect(appWindow.getByTestId("terminal-context-modal")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-context-history")).toContainText(
    "searchResults",
  );
});
