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
  await appWindow.getByRole("button", { name: "Enable Auto Reply Text" }).click();
};

const getTerminalWritesText = async (appWindow: Page) =>
  appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eTerminalWrites?: string[];
        }
      ).__e2eTerminalWrites?.join("\n") ?? "",
  );

const getLatestRequestMarkdown = async (appWindow: Page) =>
  appWindow.evaluate(() => {
    const writes =
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{
            relativePath?: string;
            content?: string;
          }>;
        }
      ).__e2eWorkspaceWrites ?? [];
    return [...writes]
      .reverse()
      .find((write) => write.relativePath?.endsWith("/request.md"))?.content;
  });

const getAllRequestMarkdownText = async (appWindow: Page) =>
  appWindow.evaluate(() => {
    const writes =
      (
        window as unknown as {
          __e2eWorkspaceWrites?: Array<{
            relativePath?: string;
            content?: string;
          }>;
        }
      ).__e2eWorkspaceWrites ?? [];
    return writes
      .filter((write) => write.relativePath?.endsWith("/request.md"))
      .map((write) => write.content ?? "")
      .join("\n---REQUEST---\n");
  });

const getActiveRunID = async (appWindow: Page) =>
  appWindow.evaluate(() => {
    const stateRaw = window.localStorage.getItem("openim_terminal_dock_state");
    const state = stateRaw ? JSON.parse(stateRaw) : {};
    const workspaceID = (
      window as unknown as {
        __e2eGetActiveWorkspaceID?: () => string | undefined;
      }
    ).__e2eGetActiveWorkspaceID?.();
    return workspaceID
      ? state.activeAgentRunByWorkspace?.[workspaceID]?.runID
      : undefined;
  });

test("@bot @e2e_self detection sends context to terminal via auto-inject", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  // Terminal should receive the auto-injected context
  await expect
    .poll(() => getTerminalWritesText(appWindow), { timeout: 5000 })
    .toContain("Current run:");

  const terminalWritesText = await getTerminalWritesText(appWindow);
  expect(terminalWritesText).toContain(".agent/skills/openim-final-answer.md");
  expect(terminalWritesText).toContain(
    "Do not send messages back to OpenIM yourself.",
  );

  const requestMarkdown = await getLatestRequestMarkdown(appWindow);
  expect(requestMarkdown).toContain("Context source: botTrigger");
  expect(requestMarkdown).toContain(
    "@bot @e2e_self summarize this conversation.",
  );
});

test("/bot @e2e_self detection creates context in terminal", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getTerminalWritesText(appWindow), { timeout: 5000 })
    .toContain("Current run:");

  // Verify the /bot trigger content is in the workspace request
  const allRequests = await getAllRequestMarkdownText(appWindow);
  expect(allRequests).toContain("/bot @e2e_self explain the previous error.");
});

test("bare @bot and agent-generated messages do not inject", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getTerminalWritesText(appWindow), { timeout: 5000 })
    .toContain("Current run:");

  const allRequests = await getAllRequestMarkdownText(appWindow);
  // bare @bot should not trigger
  expect(allRequests).not.toContain("should not trigger without a target mention");
  // agent-generated message should not trigger
  expect(allRequests).not.toContain("generated loop should be ignored");
});

test("chat input exposes a self-targeting bot mention helper", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await expect(appWindow.getByTestId("chat-agent-mention-insert")).toContainText(
    "Use @bot @E2E Self",
  );
  await appWindow.getByTestId("chat-agent-mention-insert").click();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "@bot @E2E Self",
  );
});

test("@mention autocomplete popup filters candidates and selects via click", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await appWindow.locator('[contenteditable="true"]').click();
  await appWindow.locator('[contenteditable="true"]').fill("@bot @E2");

  await expect(
    appWindow.getByTestId("bot-mention-autocomplete"),
  ).toBeVisible();
  await expect(appWindow.getByTestId("bot-mention-autocomplete")).toContainText(
    "E2E Self",
  );

  await appWindow
    .getByTestId("bot-mention-autocomplete")
    .locator("li")
    .first()
    .click();

  await expect(
    appWindow.getByTestId("bot-mention-autocomplete"),
  ).not.toBeVisible();
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "@bot @E2E Self",
  );
});

test("self-sent @bot targeted at own nickname can inject own agent", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getAllRequestMarkdownText(appWindow), { timeout: 5000 })
    .toContain("@bot @E2E Self trigger my own agent");

  const requestMarkdown = await getAllRequestMarkdownText(appWindow);
  expect(requestMarkdown).toContain("Context source: botTrigger");
});

test("compact @bot@nickname resolves a unique local target", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getAllRequestMarkdownText(appWindow), { timeout: 5000 })
    .toContain("@bot@E2E Self compact nickname target");
});

test("group @bot @e2e_self injects with group context", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { terminal: true, group: true });
  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await appWindow.getByTestId("terminal-new-workspace").click();
  await appWindow.getByTestId("terminal-workspace-name").fill("Group Bot Workspace");
  await appWindow.getByTestId("terminal-workspace-ok").click();
  await appWindow.getByTestId("terminal-new-tab").click();
  await expect(appWindow.getByTestId("terminal-start")).toBeDisabled({
    timeout: 10_000,
  });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getAllRequestMarkdownText(appWindow), { timeout: 5000 })
    .toContain("summarize this group thread");

  const allRequests = await getAllRequestMarkdownText(appWindow);
  expect(allRequests).toContain("Context source: botTrigger");
});

test("auto-inject skips pending review and sends directly to terminal", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);

  await expect
    .poll(() => getTerminalWritesText(appWindow), { timeout: 5000 })
    .toContain("Current run:");

  const terminalWritesText = await getTerminalWritesText(appWindow);
  expect(terminalWritesText).toContain(".agent/runs/");
  expect(terminalWritesText).toContain(
    "Do not send messages back to OpenIM yourself.",
  );
  const requestMarkdown = await getLatestRequestMarkdown(appWindow);
  expect(requestMarkdown).toContain("Context source: botTrigger");
  expect(requestMarkdown).toContain(
    "@bot @e2e_self summarize this conversation.",
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
    .poll(() => getTerminalWritesText(appWindow), { timeout: 5000 })
    .toContain("Current run:");

  const beforeWritesText = await getTerminalWritesText(appWindow);
  const beforeOccurrences = beforeWritesText.match(/Current run:/g)?.length ?? 0;
  expect(beforeOccurrences).toBeGreaterThan(0);

  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByTestId("terminal-auto-inject-toggle").click();
  await appWindow.getByRole("button", { name: "Enable Auto Inject" }).click();

  const writesText = await getTerminalWritesText(appWindow);
  const occurrences = writesText.match(/Current run:/g)?.length ?? 0;
  expect(occurrences).toBe(beforeOccurrences);
});

test("auto-reply requires structured final_answer to match active run", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);
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

  const runID = await expect
    .poll(() => getActiveRunID(appWindow), { timeout: 5000 })
    .not.toBeUndefined()
    .then(() => getActiveRunID(appWindow));
  expect(runID).toBeTruthy();
  if (!runID) return;

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
        text: "Unscoped structured answer must not send.",
        format: "text",
      });
    },
    { wid: workspaceID },
  );

  await expect(appWindow.getByTestId("e2e-sent-drafts")).not.toContainText(
    "Unscoped structured answer must not send.",
  );

  await appWindow.evaluate(
    ({ wid, rid }) => {
      (
        window as unknown as {
          __e2eEmitStructuredEvent?: (
            workspaceID: string,
            event: Record<string, unknown>,
          ) => void;
        }
      ).__e2eEmitStructuredEvent?.(wid, {
        type: "final_answer",
        text: "Run-scoped structured answer sends.",
        format: "text",
        runID: rid,
      });
    },
    { wid: workspaceID, rid: runID },
  );

  await expect(appWindow.getByTestId("e2e-sent-drafts")).toContainText(
    "Run-scoped structured answer sends.",
    { timeout: 5000 },
  );
});

test("auto-reply dedupes per session but allows same text from a new session", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await linkActiveConversationToWorkspace(appWindow);
  await enableAutoInject(appWindow);
  await enableBotDetection(appWindow);
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

  const runID = await expect
    .poll(() => getActiveRunID(appWindow), { timeout: 5000 })
    .not.toBeUndefined()
    .then(() => getActiveRunID(appWindow));
  expect(runID).toBeTruthy();
  if (!runID) return;

  const emitFinal = async (sessionID: string) => {
    await appWindow.evaluate(
      ({ wid, sid, rid }) => {
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
          runID: rid,
        });
      },
      { wid: workspaceID, sid: sessionID, rid: runID },
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
            (text) =>
              text?.match(/Same text from distinct sessions\./g)?.length ?? 0,
          ),
      { timeout: 5000 },
    )
    .toBe(2);
});
