import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/electron/specs",
  // These suites exercise the removed global Terminal Dock automation model.
  // Contact-scoped Agent behavior is covered by agent-sessions.spec.ts.
  testIgnore: ["**/bot-trigger.spec.ts", "**/terminal-dock.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
