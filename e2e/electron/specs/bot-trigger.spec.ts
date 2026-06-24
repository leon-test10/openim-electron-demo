import { Page } from "@playwright/test";

import { expect, test } from "../fixtures/electronApp";
import { setupTerminalHarness } from "../helpers/terminal";
import { gotoHarness } from "../helpers/wait";

const enableBotDetection = async (appWindow: Page) => {
  await appWindow.getByTestId("terminal-bot-detection-toggle").click();
};

test("single chat @bot creates pending request and sends only after user action", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await enableBotDetection(appWindow);

  const mentionRequest = appWindow
    .getByTestId("pending-agent-request")
    .filter({ hasText: "@bot summarize this conversation." });
  await expect(mentionRequest).toContainText("@bot summarize this conversation.");

  let writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain("botTrigger");

  await mentionRequest.getByTestId("pending-agent-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (window as unknown as { __e2eTerminalWrites?: string[] })
              .__e2eTerminalWrites?.join("\n") ?? "",
        ),
      { timeout: 5000 },
    )
    .toContain("botTrigger");
  writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  const terminalWritesText = writes?.join("\n") ?? "";
  expect(terminalWritesText).toContain("@bot summarize this conversation.");
  expect(terminalWritesText).toContain(
    "Do not send messages back to OpenIM by yourself.",
  );
  await expect(mentionRequest).toHaveCount(0);
});

test("/bot creates pending request and ignore does not write terminal", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await enableBotDetection(appWindow);

  const slashRequest = appWindow
    .getByTestId("pending-agent-request")
    .filter({ hasText: "/bot explain the previous error." });
  await expect(slashRequest).toContainText("/bot explain the previous error.");
  await slashRequest.getByTestId("pending-agent-ignore").click();
  await expect(slashRequest).toHaveCount(0);

  const writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain("/bot explain the previous error.");
});

test("self and agent-generated @bot messages do not create pending requests", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);
  await enableBotDetection(appWindow);

  await expect(
    appWindow.getByTestId("pending-agent-request").filter({ hasText: "from myself" }),
  ).toHaveCount(0);
  await expect(
    appWindow
      .getByTestId("pending-agent-request")
      .filter({ hasText: "generated loop should be ignored" }),
  ).toHaveCount(0);
});

test("group @bot creates pending request with review warning", async ({ appWindow }) => {
  await gotoHarness(appWindow, { terminal: true, group: true });
  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await appWindow.getByTestId("terminal-new-workspace").click();
  await appWindow.getByTestId("terminal-workspace-name").fill("Group Bot Workspace");
  await appWindow.getByTestId("terminal-workspace-ok").click();
  await enableBotDetection(appWindow);

  await expect(appWindow.getByTestId("pending-agent-request")).toContainText(
    "summarize this group thread",
  );
  await expect(appWindow.getByTestId("pending-agent-group-warning")).toContainText(
    "group chat",
  );
  await expect(appWindow.getByTestId("terminal-pending-agent-count")).toContainText(
    "Pending: 1",
  );
});
