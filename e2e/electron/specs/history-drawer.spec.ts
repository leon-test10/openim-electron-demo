import { expect, test } from "../fixtures/electronApp";
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
