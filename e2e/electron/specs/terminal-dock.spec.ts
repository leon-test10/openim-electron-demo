import { expect, test } from "../fixtures/electronApp";
import { waitForHarness } from "../helpers/wait";

test("terminal dock smoke is available without a real runtime", async ({
  appWindow,
}) => {
  await waitForHarness(appWindow);

  await expect(appWindow.getByTestId("terminal-dock")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-run-profile")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-output-draft-toggle")).toBeVisible();
  await expect(appWindow.getByTestId("terminal-draft-chat-toggle")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
