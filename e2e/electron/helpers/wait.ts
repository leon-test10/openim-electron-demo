import { Page } from "@playwright/test";

export const waitForHarness = async (page: Page) => {
  await page.waitForSelector('[data-testid="e2e-chat-area"]');
};
