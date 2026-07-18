import { expect, test } from "../fixtures/electronApp";
import { gotoHarness } from "../helpers/wait";

test("distributed worker, reviewer, revision, and human-final flow", async ({
  appWindow,
}) => {
  await gotoHarness(appWindow, { agent: true });

  const card = appWindow.getByTestId("agent-collaboration-card");
  await expect(card).toContainText("Distributed collaboration");
  await card
    .getByPlaceholder("Collaboration objective")
    .fill("Implement and independently verify the change");
  await card.getByRole("button", { name: "Start", exact: true }).click();

  await expect(card.getByText("completed", { exact: true })).toHaveCount(2);
  await card.getByRole("button", { name: "Start reviewer" }).click();
  await expect(card).toContainText(
    "Agent review is ready for the human final decision",
  );

  const instruction = card.getByPlaceholder(
    "Optional final wording, or required revision instructions",
  );
  await instruction.fill("Add restart recovery evidence");
  await card.getByRole("button", { name: "Request revision" }).click();
  await expect(card).toContainText("Human-requested revision");
  await expect(card.getByText("completed", { exact: true })).toHaveCount(4);

  await card.getByRole("button", { name: "Start reviewer" }).click();
  await expect(card).toContainText(
    "Agent review is ready for the human final decision",
  );
  await instruction.fill("Verified by the OpenIM human driver");
  await card.getByRole("button", { name: "Approve final" }).click();

  await expect(card).toContainText(
    "Human-approved: Verified by the OpenIM human driver",
  );
  await expect(card.getByText("completed", { exact: true })).toHaveCount(6);
});
