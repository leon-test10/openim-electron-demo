import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "../fixtures/electronApp";

const getAppURL = (hash = "#/login") =>
  `${pathToFileURL(path.join(process.cwd(), "dist/index.html")).toString()}${hash}`;

test("offline mode creates a virtual friend conversation with persistent messages", async ({
  appWindow,
}) => {
  await appWindow.goto(getAppURL("#/login"));
  await appWindow.evaluate(async () => {
    window.localStorage.clear();
    const databases = await indexedDB.databases?.();
    await Promise.all(
      (databases ?? [])
        .filter((database) => database.name)
        .map(
          (database) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(database.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            }),
        ),
    );
  });
  await appWindow.goto(getAppURL("#/login"));

  await appWindow.getByTestId("offline-terminal-login").click();
  await expect(appWindow).toHaveURL(/#\/chat/);
  await expect(appWindow.getByTestId("offline-create-friend-button")).toBeVisible();

  await appWindow.getByTestId("offline-create-friend-button").click();
  await appWindow.getByTestId("offline-friend-nickname").fill("Local Agent");
  await appWindow.getByTestId("offline-friend-create-confirm").click();

  await expect(appWindow.getByText("Local Agent").first()).toBeVisible();
  await expect(appWindow).toHaveURL(/#\/chat\/offline_si_/);

  await appWindow.locator(".ck-content[contenteditable='true']").fill("hello offline");
  await appWindow.getByTestId("chat-footer-send").click();
  await expect(appWindow.getByText("hello offline")).toBeVisible();

  await appWindow.reload();
  await expect(appWindow).toHaveURL(/#\/chat\/offline_si_/);
  await expect(appWindow.getByText("Local Agent").first()).toBeVisible();
  await expect(appWindow.getByText("hello offline").first()).toBeVisible();
});
