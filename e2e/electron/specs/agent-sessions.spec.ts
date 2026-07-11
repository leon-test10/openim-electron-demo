import { expect, test } from "../fixtures/electronApp";
import { gotoHarness } from "../helpers/wait";

test("Agent panel follows contacts while background work continues", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });

  await expect(appWindow.getByTestId("agent-panel")).toBeVisible();
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
