import { Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

type HarnessOptions = {
  terminal?: boolean;
  group?: boolean;
  agent?: boolean;
};

export const getHarnessURL = (options: HarnessOptions = {}) => {
  const indexURL = pathToFileURL(path.join(process.cwd(), "dist/index.html"));
  const params = new URLSearchParams();
  if (options.terminal) params.set("terminal", "1");
  if (options.group) params.set("group", "1");
  if (options.agent) params.set("agent", "1");
  const query = params.toString();

  return `${indexURL.toString()}#/e2e-harness${query ? `?${query}` : ""}`;
};

export const gotoHarness = async (page: Page, options: HarnessOptions = {}) => {
  await page.goto(getHarnessURL(options));
  await page.waitForURL(/e2e-harness/);
  await waitForHarness(page);
};

export const waitForHarness = async (page: Page) => {
  await page.waitForSelector('[data-testid="e2e-chat-area"]', {
    state: "attached",
  });
  await page.getByTestId("chat-header-more").waitFor({
    state: "visible",
  });
};
