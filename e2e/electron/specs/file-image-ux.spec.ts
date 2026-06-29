import { expect, test } from "../fixtures/electronApp";
import { e2eAttachmentMessageIDs, e2eMessageIDs } from "../fixtures/mockOpenIM";
import { messageActionTrigger } from "../helpers/selectors";
import { setupTerminalHarness } from "../helpers/terminal";

type E2EWindow = Window & {
  __e2eWorkspaceWrites?: Array<{
    relativePath?: string;
    content?: string;
    mtimeMs?: number;
  }>;
  __e2eFileActions?: Array<{
    channel: string;
    nativePath?: string;
    sourceUrl?: string;
    fileName?: string;
    saveAs?: boolean;
  }>;
  __e2eSentAttachments?: Array<{
    fileName?: string;
    relativePath?: string;
    sendKind?: string;
  }>;
  __e2eAutoFileAttachDiagnostics?: Array<Record<string, unknown>>;
  __e2eGetActiveWorkspaceID?: () => string | undefined;
  __e2eLinkActiveConversationToWorkspace?: () => void;
};

test("run final answer preview and output files use image/file pending kinds", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow, { startTerminal: true });
  await appWindow.evaluate(() => {
    (window as E2EWindow).__e2eLinkActiveConversationToWorkspace?.();
  });

  await appWindow.locator(messageActionTrigger(e2eMessageIDs[0])).click();
  await appWindow.getByTestId("message-action-select").click();
  await appWindow.getByTestId("message-selection-send").click();

  await expect
    .poll(
      () =>
        appWindow.evaluate(
          () =>
            (window as E2EWindow).__e2eWorkspaceWrites?.some((write) =>
              /^\.agent\/runs\/run_.*\/manifest\.json$/.test(
                write.relativePath ?? "",
              ),
            ) ?? false,
        ),
      { timeout: 5000 },
    )
    .toBeTruthy();

  const runManifestWrite = await appWindow.evaluate(() =>
    (window as E2EWindow).__e2eWorkspaceWrites?.find((write) =>
      /^\.agent\/runs\/run_.*\/manifest\.json$/.test(write.relativePath ?? ""),
    ),
  );

  await appWindow.getByTestId("terminal-auto-file-attach-toggle").click();
  await appWindow
    .getByRole("button", { name: "Enable Auto File Attachment" })
    .click();

  await expect(
    appWindow.getByTestId("terminal-auto-file-attach-toggle"),
  ).toBeChecked();

  const manifest = JSON.parse(runManifestWrite?.content ?? "{}") as {
    runID: string;
    requestPath: string;
    finalAnswerPath: string;
    updatedAt: number;
  };

  await appWindow.evaluate(
    ({ manifestPath, finalAnswerPath, manifest: baseManifest }) => {
      const writes = (window as E2EWindow).__e2eWorkspaceWrites ?? [];
      const completedAt = Date.now() + 1000;
      writes.push({
        relativePath: "output/test_image.png",
        content: "png fixture",
        mtimeMs: completedAt,
      });
      writes.push({
        relativePath: "output/test_file.md",
        content: "# markdown fixture",
        mtimeMs: completedAt + 1,
      });
      writes.push({
        relativePath: "output/test_folder/",
        content: "",
        mtimeMs: completedAt + 2,
      });
      writes.push({
        relativePath: "output/test_folder/nested.txt",
        content: "nested folder fixture",
        mtimeMs: completedAt + 3,
      });
      writes.push({
        relativePath: "output/empty_folder/",
        content: "",
        mtimeMs: completedAt + 4,
      });
      writes.push({
        relativePath: finalAnswerPath,
        content: [
          "# Final Answer",
          "",
          "IM-ready answer from final_answer.md.",
          "",
          "## Output Files",
          "- output/test_image.png",
          "- output/test_file.md",
          "- output/test_folder/nested.txt",
          "",
          "## Output Folders",
          "- output/test_folder/",
          "- output/empty_folder/",
        ].join("\n"),
        mtimeMs: completedAt + 5,
      });
      writes.push({
        relativePath: manifestPath,
        content: JSON.stringify(
          {
            ...baseManifest,
            status: "completed",
            updatedAt: completedAt + 6,
          },
          null,
          2,
        ),
        mtimeMs: completedAt + 6,
      });
    },
    {
      manifestPath: runManifestWrite?.relativePath,
      finalAnswerPath: manifest.finalAnswerPath,
      manifest,
    },
  );
  await appWindow.evaluate(() => {
    (window as E2EWindow).__e2eEmitTerminalOutput?.(
      "\nFinal reply has been written to final_answer.md.\n",
    );
  });

  await expect(appWindow.getByTestId("terminal-final-answer-preview")).toHaveCount(0);

  const readAutoFileAttachSnapshot = () =>
    appWindow.evaluate(() =>
      JSON.stringify(
        {
          sentAttachments:
            (window as E2EWindow).__e2eSentAttachments?.map((attachment) => ({
              fileName: attachment.fileName,
              relativePath: attachment.relativePath,
              sendKind: attachment.sendKind,
            })) ?? [],
          diagnostics: (window as E2EWindow).__e2eAutoFileAttachDiagnostics ?? [],
        },
        null,
        2,
      ),
    );
  await expect
    .poll(readAutoFileAttachSnapshot, { timeout: 6000 })
    .toContain("test_image.png");
  await expect.poll(readAutoFileAttachSnapshot).toContain("output/test_image.png");
  await expect.poll(readAutoFileAttachSnapshot).toContain('"sendKind": "image"');
  await expect.poll(readAutoFileAttachSnapshot).toContain("test_file.md");
  await expect.poll(readAutoFileAttachSnapshot).toContain("output/test_file.md");
  await expect.poll(readAutoFileAttachSnapshot).toContain('"sendKind": "file"');
  await expect.poll(readAutoFileAttachSnapshot).toContain("test_folder");
  await expect
    .poll(readAutoFileAttachSnapshot)
    .toContain("output/test_folder/");
  await expect.poll(readAutoFileAttachSnapshot).toContain('"sendKind": "folder"');
  await expect.poll(readAutoFileAttachSnapshot).toContain("empty_folder");
  await expect
    .poll(readAutoFileAttachSnapshot)
    .toContain("output/empty_folder/");
  await expect.poll(readAutoFileAttachSnapshot).not.toContain("nested.txt");
  await expect
    .poll(readAutoFileAttachSnapshot)
    .not.toContain("output/test_folder/nested.txt");
});

test("file card actions use desktop IPC instead of browser navigation", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await appWindow
    .locator(messageActionTrigger(e2eAttachmentMessageIDs.failedFile))
    .click();
  await appWindow.getByTestId("message-action-view").click();

  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) => action.channel === "file:openPath",
          ) ?? false,
      ),
    )
    .toBeTruthy();

  await appWindow
    .locator(messageActionTrigger(e2eAttachmentMessageIDs.failedFile))
    .click();
  await appWindow.getByTestId("message-action-save-as").click();

  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) =>
              action.channel === "file:downloadToLocal" && action.saveAs === true,
          ) ?? false,
      ),
    )
    .toBeTruthy();

  await appWindow
    .locator(messageActionTrigger(e2eAttachmentMessageIDs.failedFile))
    .click();
  await appWindow.getByTestId("message-action-show-in-folder").click();

  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) => action.channel === "file:showItemInFolder",
          ) ?? false,
      ),
    )
    .toBeTruthy();
});

test("manual folder picker IPC can scan a selected folder", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  const folderScan = await appWindow.evaluate(async () => {
    const folder = await window.electronAPI.ipcInvoke<{
      folderPath: string;
      folderName: string;
    }>("file:selectFolder");
    return window.electronAPI.ipcInvoke<{
      folderName: string;
      itemCount: number;
      files: Array<{ relativePath: string; nativePath?: string }>;
    }>("folder:scan", {
      nativePath: folder.folderPath,
      folderName: folder.folderName,
    });
  });

  expect(folderScan.folderName).toBe("skills");
  expect(folderScan.itemCount).toBe(1);
  expect(folderScan.files[0].relativePath).toBe("nested.txt");
  expect(JSON.stringify(folderScan.files.map((file) => file.relativePath))).not.toContain(
    "C:\\",
  );
});

test("folder shares render as one folder card without zip fallback", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  const folderItem = appWindow.getByTestId(
    `message-item-${e2eAttachmentMessageIDs.folder}`,
  );
  await expect(folderItem).toContainText("skills(1)");
  await expect(folderItem).toContainText("67.1 KB");
  await expect(folderItem.getByTestId("folder-message-open")).toHaveText(
    "打开文件夹",
  );
  await expect(folderItem).not.toContainText(".zip");
  await expect(folderItem).not.toContainText("添加到");

  await expect(folderItem.getByTestId("folder-message-download-share")).toHaveText(
    "Download Folder",
  );
  await folderItem.getByTestId("folder-message-download-share").click();
  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) => action.channel === "folder:downloadShare",
          ) ?? false,
      ),
    )
    .toBeTruthy();

  await folderItem.getByTestId("folder-message-open").click();
  await expect(appWindow.getByText("SKILL.md")).toBeVisible();
  await expect(appWindow.getByTestId("folder-message-download-all")).toBeVisible();
  await expect(appWindow.getByTestId("folder-message-open-file")).toBeVisible();
  await expect(appWindow.getByTestId("folder-message-download-file")).toBeVisible();
  await expect(appWindow.getByRole("dialog")).not.toContainText("C:\\");

  await appWindow.getByTestId("folder-message-download-file").click();
  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) => action.channel === "file:downloadToLocal",
          ) ?? false,
      ),
    )
    .toBeTruthy();

  await appWindow.getByTestId("folder-message-download-all").click();
  await expect
    .poll(() =>
      appWindow.evaluate(
        () =>
          (window as E2EWindow).__e2eFileActions?.some(
            (action) => action.channel === "folder:downloadShare",
          ) ?? false,
      ),
    )
    .toBeTruthy();
});

test("image messages keep the built-in image preview renderer", async ({
  appWindow,
}) => {
  await setupTerminalHarness(appWindow);

  await expect(
    appWindow
      .getByTestId(`message-item-${e2eAttachmentMessageIDs.image}`)
      .locator(".message-image"),
  ).toBeVisible();
});
