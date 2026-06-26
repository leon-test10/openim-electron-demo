import { Page } from "@playwright/test";

import { expect, test } from "../fixtures/electronApp";
import { setupTerminalHarness } from "../helpers/terminal";
import { gotoHarness } from "../helpers/wait";

const enableBotDetection = async (appWindow: Page) => {
  await appWindow.getByTestId("terminal-bot-detection-toggle").click();
};

const linkActiveConversationToWorkspace = async (appWindow: Page) => {
  await appWindow.evaluate(() => {
    (
      window as unknown as {
        __e2eLinkActiveConversationToWorkspace?: () => void;
      }
    ).__e2eLinkActiveConversationToWorkspace?.();
  });
};

const enableAutoInject = async (appWindow: Page) => {
  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Inject" }).click();
};

const enableAutoReply = async (appWindow: Page) => {
  await appWindow.getByTestId("terminal-auto-reply-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Reply" }).click();
};

test("single chat @bot @e2e_self creates pending request and sends only after user action", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await enableBotDetection(appWindow);

  const mentionRequest = appWindow
    .getByTestId("pending-agent-request")
    .filter({ hasText: "@bot @e2e_self summarize this conversation." });
  await expect(mentionRequest).toContainText(
    "@bot @e2e_self summarize this conversation.",
  );

  let writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain("botTrigger");

  await mentionRequest.getByTestId("pending-agent-review").click();
  writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain("botTrigger");

  await mentionRequest.getByTestId("pending-agent-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as { __e2eTerminalWrites?: string[] }
            ).__e2eTerminalWrites?.join("\n") ?? "",
        ),
      { timeout: 5000 },
    )
    .toContain("botTrigger");
  writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  const terminalWritesText = writes?.join("\n") ?? "";
  expect(terminalWritesText).toContain("@bot @e2e_self summarize this conversation.");
  expect(terminalWritesText).toContain(
    "Do not send messages back to OpenIM by yourself.",
  );
  await expect(mentionRequest).toHaveCount(0);
});

test("/bot @e2e_self creates pending request and stays pending until manual send", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await enableBotDetection(appWindow);

  const slashRequest = appWindow
    .getByTestId("pending-agent-request")
    .filter({ hasText: "/bot @e2e_self explain the previous error." });
  await expect(slashRequest).toContainText(
    "/bot @e2e_self explain the previous error.",
  );
  await expect(slashRequest.getByTestId("pending-agent-review")).toBeVisible();
  await expect(slashRequest.getByTestId("pending-agent-send")).toBeVisible();

  const writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  expect(writes?.join("\n") ?? "").not.toContain(
    "/bot @e2e_self explain the previous error.",
  );
});

test("self and agent-generated @bot messages do not create pending requests", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);
  await enableBotDetection(appWindow);

  // Self-sent @bot message should be ignored
  await expect(
    appWindow.getByTestId("pending-agent-request").filter({ hasText: "from myself" }),
  ).toHaveCount(0);
  // Agent-generated message should be ignored
  await expect(
    appWindow
      .getByTestId("pending-agent-request")
      .filter({ hasText: "generated loop should be ignored" }),
  ).toHaveCount(0);
});

test("group @bot @e2e_self creates pending request with review warning", async ({
  appWindow,
}) => {
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

test("auto-inject skips pending review and sends directly to terminal", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  // Enable auto-inject BEFORE bot detection so the first scan uses auto-inject
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  // Terminal should have received the auto-injected context immediately
  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as { __e2eTerminalWrites?: string[] }
            ).__e2eTerminalWrites?.join("\n") ?? "",
        ),
      { timeout: 5000 },
    )
    .toContain("botTrigger");

  // Verify the auto-injected content
  const writes = await appWindow.evaluate(
    () => (window as unknown as { __e2eTerminalWrites?: string[] }).__e2eTerminalWrites,
  );
  const terminalWritesText = writes?.join("\n") ?? "";
  expect(terminalWritesText).toContain("@bot @e2e_self summarize this conversation.");
  expect(terminalWritesText).toContain(
    "Do not send messages back to OpenIM by yourself.",
  );
});

test("auto-inject does not duplicate the same trigger on repeated scans", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (
              window as unknown as { __e2eTerminalWrites?: string[] }
            ).__e2eTerminalWrites?.join("\n") ?? "",
        ),
      { timeout: 5000 },
    )
    .toContain("botTrigger");

  const beforeWritesText = await appWindow.evaluate(
    () =>
      (
        window as unknown as { __e2eTerminalWrites?: string[] }
      ).__e2eTerminalWrites?.join("\n") ?? "",
  );
  const beforeOccurrences =
    beforeWritesText.match(/Context source: botTrigger/g)?.length ?? 0;
  expect(beforeOccurrences).toBeGreaterThan(0);

  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Inject" }).click();

  const writesText = await appWindow.evaluate(
    () =>
      (
        window as unknown as { __e2eTerminalWrites?: string[] }
      ).__e2eTerminalWrites?.join("\n") ?? "",
  );
  const occurrences = writesText.match(/Context source: botTrigger/g)?.length ?? 0;
  expect(occurrences).toBe(beforeOccurrences);
});

test("auto-reply sends structured final_answer to IM", async ({ appWindow }) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);

  // Enable auto-reply
  await enableAutoReply(appWindow);

  // Get workspace ID and emit a structured final_answer
  const workspaceID = await appWindow.evaluate(() =>
    (
      window as unknown as {
        __e2eGetActiveWorkspaceID?: () => string | undefined;
      }
    ).__e2eGetActiveWorkspaceID?.(),
  );
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  await appWindow.evaluate(
    ({ wid }) => {
      (
        window as unknown as {
          __e2eEmitStructuredEvent?: (
            workspaceID: string,
            event: Record<string, unknown>,
          ) => void;
        }
      ).__e2eEmitStructuredEvent?.(wid, {
        type: "final_answer",
        text: "Auto-reply test: the answer is 42.",
        format: "text",
      });
    },
    { wid: workspaceID },
  );

  // The answer should appear in sent drafts
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toContainText(
    "Auto-reply test: the answer is 42.",
    { timeout: 5000 },
  );
});

test("auto-reply dedupes per session but allows same text from a new session", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoReply(appWindow);

  const workspaceID = await appWindow.evaluate(() =>
    (
      window as unknown as {
        __e2eGetActiveWorkspaceID?: () => string | undefined;
      }
    ).__e2eGetActiveWorkspaceID?.(),
  );
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  const emitFinal = async (sessionID: string) => {
    await appWindow.evaluate(
      ({ wid, sid }) => {
        (
          window as unknown as {
            __e2eEmitStructuredEvent?: (
              workspaceID: string,
              event: Record<string, unknown>,
            ) => void;
          }
        ).__e2eEmitStructuredEvent?.(wid, {
          type: "final_answer",
          text: "Same text from distinct sessions.",
          format: "text",
          sessionID: sid,
        });
      },
      { wid: workspaceID, sid: sessionID },
    );
  };

  await emitFinal("session-a");
  await emitFinal("session-a");
  await emitFinal("session-b");

  await expect
    .poll(
      () =>
        appWindow
          .getByTestId("e2e-sent-drafts")
          .textContent()
          .then(
            (text) => text?.match(/Same text from distinct sessions\./g)?.length ?? 0,
          ),
      { timeout: 5000 },
    )
    .toBe(2);
});
