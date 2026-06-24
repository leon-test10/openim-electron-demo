import {
  ElectronApplication,
  Page,
  _electron as electron,
  test as base,
} from "@playwright/test";

type ElectronFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [".", "--no-sandbox"],
      env: {
        ...process.env,
        E2E_MODE: "1",
        NODE_ENV: "test",
      },
    });

    await use(app);
    await app.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.evaluate(() => {
      window.location.hash = "#/e2e-harness";
    });
    await window.waitForURL(/e2e-harness/);
    await use(window);
  },
});

export { expect } from "@playwright/test";
