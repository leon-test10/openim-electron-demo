import { expect, test } from "../fixtures/electronApp";
import { gotoHarness } from "../helpers/wait";

test("Agent panel follows contacts while background work continues", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });

  await expect(appWindow.getByTestId("agent-panel")).toBeVisible();
  await expect(appWindow.getByTestId("agent-auto-send-reply")).toBeVisible();
  await expect(appWindow.getByTestId("agent-auto-attach-output")).toBeVisible();
  await expect(
    appWindow.getByTestId("agent-panel").getByText("Contact 1 task"),
  ).toBeVisible();
  await expect(appWindow.getByTestId("agent-terminal-panel")).toContainText(
    "Contact 1 task",
  );

  const composer = appWindow.getByPlaceholder("Message Agent");
  await composer.fill("finish contact one task");
  await appWindow.getByRole("button", { name: "Send" }).click();
  await expect(appWindow.getByText("running", { exact: true })).toBeVisible();

  await appWindow.getByTestId("agent-contact-2").click();
  await expect(
    appWindow.getByTestId("agent-panel").getByText("Contact 2 task"),
  ).toBeVisible();
  await expect(appWindow.getByTestId("agent-terminal-panel")).toContainText(
    "Contact 2 task",
  );

  await expect(appWindow.getByTestId("agent-contact-1-unread")).toHaveText("1");
  await appWindow.getByTestId("agent-contact-1").click();
  await expect(
    appWindow.getByText("Completed in background: finish contact one task"),
  ).toBeVisible();
  await expect(appWindow.getByTestId("agent-contact-1-unread")).toHaveText("0");

  await appWindow.getByTestId("agent-model-select").click();
  await appWindow.getByText("E2E Provider · E2E Model (default)").click();

  await expect(appWindow.getByTestId("agent-staged-result")).toBeVisible();
  const stagedAnswer = appWindow.getByTestId("agent-staged-final-answer");
  await stagedAnswer.fill("Human edited result for contact one");
  await stagedAnswer.blur();
  await appWindow.getByTestId("agent-confirm-and-send").click();
  await expect(appWindow.getByTestId("e2e-sent-drafts")).toContainText(
    "Human edited result for contact one",
  );

  const attachedSessions = await appWindow.evaluate(
    () =>
      (
        window as unknown as {
          __e2eAgentTerminalSessionIDs?: string[];
        }
      ).__e2eAgentTerminalSessionIDs ?? [],
  );
  expect(attachedSessions).toContain("e2e-agent-contact-1");
  expect(attachedSessions).toContain("e2e-agent-contact-2");
});

test("Agent assistant text renders progressively while running", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });
  const composer = appWindow.getByPlaceholder("Message Agent");
  await composer.fill("stream this response");
  await appWindow.getByRole("button", { name: "Send" }).click();

  const streamed = appWindow.getByTestId("agent-streaming-text").last();
  await expect(streamed).toBeVisible();
  await expect
    .poll(async () => (await streamed.textContent())?.length ?? 0)
    .toBeGreaterThan(0);
  await expect(streamed).toContainText("Completed in background: stream this response");
});
