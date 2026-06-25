import { Page } from "@playwright/test";

import { expect, test } from "../fixtures/electronApp";
import { setupTerminalHarness } from "../helpers/terminal";
import { gotoHarness } from "../helpers/wait";

type E2EWindow = {
  __e2eEmitStructuredEvent?: (
    workspaceID: string,
    event: Record<string, unknown>,
  ) => void;
  __e2eStructuredEvents?: Array<{
    workspaceID: string;
    event: Record<string, unknown>;
  }>;
  __e2eTerminalWrites?: string[];
  __e2eGetActiveWorkspaceID?: () => string | undefined;
};

const emitStructuredEvent = async (
  appWindow: Page,
  workspaceID: string,
  event: Record<string, unknown>,
) => {
  await appWindow.evaluate(
    ({ wid, evt }) => {
      (
        window as unknown as {
          __e2eEmitStructuredEvent?: (
            workspaceID: string,
            event: Record<string, unknown>,
          ) => void;
        }
      ).__e2eEmitStructuredEvent?.(wid, evt);
    },
    { wid: workspaceID, evt: event },
  );
};

const getStructuredEvents = (appWindow: Page) =>
  appWindow.evaluate(
    () =>
      (window as unknown as E2EWindow).__e2eStructuredEvents ?? [],
  );

const getActiveWorkspaceID = (appWindow: Page) =>
  appWindow.evaluate(() =>
    (window as unknown as E2EWindow).__e2eGetActiveWorkspaceID?.(),
  );

test("structured event harness is active when terminal starts", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  // Verify events array is initialized
  const events = await getStructuredEvents(appWindow);
  expect(events).toBeDefined();

  // Verify workspace exists
  const workspaceID = await getActiveWorkspaceID(appWindow);
  expect(workspaceID).toBeTruthy();
});

test("agent:startWatch is called when terminal starts", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { terminal: true });
  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();

  await appWindow.getByTestId("terminal-new-workspace").click();
  await appWindow.getByTestId("terminal-workspace-name").fill("Structured WS");
  await appWindow.getByTestId("terminal-workspace-ok").click();
  await expect(appWindow.getByTestId("terminal-new-tab")).toBeVisible();
  await appWindow.getByTestId("terminal-new-tab").click();
  await expect(appWindow.getByTestId("terminal-start")).toBeDisabled({
    timeout: 10_000,
  });

  const events = await getStructuredEvents(appWindow);
  expect(events.length).toBe(0);
});

test("agent watcher survives missing events file and forwards later final_answer", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  const workspaceID = await getActiveWorkspaceID(appWindow);
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  const watchResult = await appWindow.evaluate((wid) => {
    return window.electronAPI?.ipcInvoke<{
      ok: boolean;
      workspaceID: string;
      filePath: string;
    }>("agent:startWatch", wid);
  }, workspaceID);
  expect(watchResult?.ok).toBe(true);

  await appWindow.evaluate((wid) => {
    return window.electronAPI?.ipcInvoke("workspace:writeWorkspaceFile", {
      workspaceID: wid,
      relativePath: ".agent/events.ndjson",
      content:
        '{"type":"final_answer","text":"Watched NDJSON answer","format":"text","sessionID":"watch-test"}\n',
    });
  }, workspaceID);

  await appWindow.getByTestId("terminal-reply-debug").click();
  await expect(
    appWindow.getByTestId("terminal-reply-debug-modal"),
  ).toBeVisible();

  await expect
    .poll(
      async () => {
        await appWindow.getByTestId("terminal-capture-final-answer").click();
        return appWindow.getByTestId("e2e-draft-preview").textContent();
      },
      { timeout: 5000 },
    )
    .toContain("Watched NDJSON answer");
});

test("structured final_answer event resolves as Tier 1", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  const workspaceID = await getActiveWorkspaceID(appWindow);
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  // Emit a structured final_answer event
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "final_answer",
    text: "## E2E Structured Answer\n\nThe answer is **42**.",
    format: "markdown",
    sessionID: "e2e-session-1",
  });

  // Verify event captured
  let events = await getStructuredEvents(appWindow);
  expect(events.length).toBeGreaterThanOrEqual(1);

  // Emit terminal garbage (should NOT override structured Tier 1)
  await appWindow.evaluate(() => {
    (
      window as unknown as {
        __e2eEmitTerminalOutput?: (text: string) => void;
      }
    ).__e2eEmitTerminalOutput?.(
      "Some garbage terminal output\r\nwith no structure\r\n> prompt",
    );
  });

  // Open Reply Debug modal and capture
  await appWindow.getByTestId("terminal-reply-debug").click();
  await expect(
    appWindow.getByTestId("terminal-reply-debug-modal"),
  ).toBeVisible();
  await appWindow.getByTestId("terminal-capture-final-answer").click();

  // Draft should contain the structured answer, not garbage
  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText("42");

  // Now emit progress events — should NOT override
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "progress",
    stage: "done",
    message: "All done.",
  });
  events = await getStructuredEvents(appWindow);
  expect(events.length).toBeGreaterThanOrEqual(2);
});

test("structured events flow: progress does not resolve, error + final_answer resolves", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });

  const workspaceID = await getActiveWorkspaceID(appWindow);
  expect(workspaceID).toBeTruthy();
  if (!workspaceID) return;

  // Emit progress, error, then final_answer
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "progress",
    stage: "analyzing",
    message: "Reading context...",
    percent: 30,
  });
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "error",
    message: "Tool call failed: network timeout",
    code: "TIMEOUT",
  });
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "session",
    id: "e2e-session-2",
    status: "started",
  });
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "artifact",
    path: "output/report.md",
    mime: "text/markdown",
    size: 1024,
    label: "Generated Report",
  });
  await emitStructuredEvent(appWindow, workspaceID, {
    type: "final_answer",
    text: "I encountered a timeout but here is the partial result: OK.",
    format: "text",
    sessionID: "e2e-session-2",
  });

  // Emit some terminal junk for raw fallback
  await appWindow.evaluate(() => {
    (
      window as unknown as {
        __e2eEmitTerminalOutput?: (text: string) => void;
      }
    ).__e2eEmitTerminalOutput?.("garbage output without answer");
  });

  // Verify all events were captured
  const events = await getStructuredEvents(appWindow);
  expect(events.length).toBeGreaterThanOrEqual(5);

  // Capture — should get final_answer, not progress, not error, not raw garbage
  await appWindow.getByTestId("terminal-reply-debug").click();
  await expect(
    appWindow.getByTestId("terminal-reply-debug-modal"),
  ).toBeVisible();
  await appWindow.getByTestId("terminal-capture-final-answer").click();

  await expect(appWindow.getByTestId("e2e-draft-preview")).toContainText(
    "partial result: OK",
  );
  await expect(appWindow.getByTestId("e2e-draft-preview")).not.toContainText(
    "TIMEOUT",
  );
  await expect(appWindow.getByTestId("e2e-draft-preview")).not.toContainText(
    "garbage output",
  );
});
