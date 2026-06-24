import { expect, Page } from "@playwright/test";

import { gotoHarness } from "./wait";

type TerminalHarnessOptions = {
  startTerminal?: boolean;
};

export const setupTerminalHarness = async (
  page: Page,
  options: TerminalHarnessOptions = {},
) => {
  await gotoHarness(page, { terminal: true });
  await expect(page.getByTestId("terminal-dock")).toBeVisible();

  await page.getByTestId("terminal-new-workspace").click();
  await page.getByTestId("terminal-workspace-name").fill("P6 Workspace");
  await page.getByTestId("terminal-workspace-ok").click();
  await expect(page.getByTestId("terminal-new-tab")).toBeVisible();

  if (options.startTerminal) {
    await page.getByTestId("terminal-new-tab").click();
    await expect(page.getByTestId("terminal-start")).toBeDisabled({
      timeout: 10_000,
    });
  }
};
