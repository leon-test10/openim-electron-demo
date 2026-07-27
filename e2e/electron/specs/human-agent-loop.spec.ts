import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/electronApp";
import { gotoHarness } from "../helpers/wait";

const runAgent = async (appWindow: Page, prompt: string) => {
  const composer = appWindow.getByPlaceholder("Message Agent");
  await composer.fill(prompt);
  await appWindow.getByTestId("agent-send-message").click();
  await expect(appWindow.getByTestId("agent-staged-result")).toBeVisible();
};

test("requester-context-policy: requester authorization is shown on the staged Run", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  await runAgent(appWindow, "context-policy request");
  await expect(appWindow.getByTestId("agent-authorized-context-count")).toContainText(
    "Used 10 messages authorized by the requester",
  );
});

test("session-binding-recovery: IM and Runtime disconnects remain distinguishable", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  await expect(appWindow.getByTestId("agent-binding-state")).toContainText("bound");

  await appWindow.evaluate(() =>
    window.electronAPI?.ipcInvoke("agent-session:setIMOnline", false),
  );
  await expect(appWindow.getByTestId("agent-binding-state")).toContainText(
    "im_offline",
  );

  await appWindow.evaluate(async () => {
    await window.electronAPI?.ipcInvoke("agent-session:setIMOnline", true);
    await window.electronAPI?.ipcInvoke("agent-session:e2eRuntimeStatus", {
      sessionID: "e2e-agent-contact-1",
      status: "disconnected",
      lastError: "E2E Runtime disconnected",
    });
  });
  await expect(appWindow.getByTestId("agent-binding-state")).toContainText(
    "runtime_disconnected",
  );
  await appWindow.getByRole("button", { name: "Reconnect Runtime" }).click();
  await expect(appWindow.getByTestId("agent-binding-state")).toContainText("bound");
});

test("result-staging: completion is editable and unpublished until confirmation", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  await runAgent(appWindow, "stage this result");
  await expect(appWindow.getByTestId("e2e-sent-drafts")).not.toContainText(
    "stage this result",
  );
  const answer = appWindow.getByTestId("agent-staged-final-answer");
  await answer.fill("Human approved edited answer");
  await appWindow.getByTestId("agent-confirm-and-send").click();
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toContainText(
    "Human approved edited answer",
  );
});

test("artifact-folder-delivery: nested output is represented by one folder Artifact", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  await runAgent(appWindow, "create nested folder output");
  const artifacts = appWindow.getByTestId("agent-staged-artifacts");
  await expect(artifacts).toContainText("folder · nested-output");
  await expect(artifacts.locator("> div")).toHaveCount(1);
  await appWindow.getByTestId("agent-confirm-and-send").click();
  await expect(appWindow.getByTestId("agent-staged-result")).toHaveCount(0);
});

test("improvement-candidate: user can record and triage a controlled improvement", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  await runAgent(appWindow, "candidate result");
  await expect(appWindow.getByTestId("agent-improvement-backlog")).toHaveCount(0);
  await appWindow.getByTestId("agent-suggest-improvement").click();
  const backlog = appWindow.getByTestId("agent-improvement-backlog");
  await expect(backlog).toContainText("Review this Agent Run");
  await backlog.getByRole("button", { name: "Approve" }).click();
  await expect(backlog).toContainText("approved");
});
