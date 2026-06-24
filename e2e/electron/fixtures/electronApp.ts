import {
  ElectronApplication,
  Page,
  _electron as electron,
  test as base,
} from "@playwright/test";

import { gotoHarness } from "../helpers/wait";

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
    const processHandle = (app as ElectronApplication & {
      process?: () => { kill: () => void };
    }).process?.();
    let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        app.close(),
        new Promise<void>((resolve) => {
          forceCloseTimer = setTimeout(() => {
            try {
              processHandle?.kill();
            } catch {
              // Ignore force-close errors in E2E cleanup.
            }
            resolve();
          }, 5000);
        }),
      ]);
    } finally {
      if (forceCloseTimer) {
        clearTimeout(forceCloseTimer);
      }
    }
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await gotoHarness(window);
    await use(window);
  },
});

export { expect } from "@playwright/test";
