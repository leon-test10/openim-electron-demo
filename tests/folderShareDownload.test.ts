/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { downloadFolderShare } = require("../electron/main/folderShareDownload");

const mkdtemp = () => fs.mkdtempSync(path.join(os.tmpdir(), "folder-share-test-"));

const readUtf8 = (filePath: string) => fs.readFileSync(filePath, "utf8");

(async () => {
  const targetRoot = mkdtemp();
  const downloaded: Array<{ sourceUrl: string; targetPath: string }> = [];

  const summary = await downloadFolderShare(
    {
      shareID: "share-1",
      folderName: "output",
      files: [
        {
          relativePath: "a.txt",
          fileName: "a.txt",
          sourceUrl: "https://example.test/a.txt",
        },
        {
          relativePath: "sub/deep/c file 中文.json",
          fileName: "c file 中文.json",
          sourceUrl: "https://example.test/c.json",
        },
        {
          relativePath: "../evil.txt",
          fileName: "evil.txt",
          sourceUrl: "https://example.test/evil.txt",
        },
        {
          relativePath: "missing-url.txt",
          fileName: "missing-url.txt",
        },
      ],
    },
    {
      chooseTargetRoot: async () => targetRoot,
      downloadUrlToPath: async (sourceUrl: URL, targetPath: string) => {
        downloaded.push({ sourceUrl: sourceUrl.href, targetPath });
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, `downloaded:${sourceUrl.href}`);
        return targetPath;
      },
    },
  );

  assert.equal(summary.canceled, false);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failedCount, 2);
  assert.equal(summary.folderPath, path.join(targetRoot, "output"));
  assert.equal(
    readUtf8(path.join(targetRoot, "output", "a.txt")),
    "downloaded:https://example.test/a.txt",
  );
  assert.equal(
    readUtf8(path.join(targetRoot, "output", "sub", "deep", "c file 中文.json")),
    "downloaded:https://example.test/c.json",
  );
  assert.equal(fs.existsSync(path.join(targetRoot, "evil.txt")), false);
  assert.deepEqual(
    summary.failedFiles.map((file: { relativePath: string }) => file.relativePath),
    ["../evil.txt", "missing-url.txt"],
  );
  assert.equal(downloaded.length, 2);

  const emptyRoot = mkdtemp();
  const emptySummary = await downloadFolderShare(
    {
      shareID: "empty/share:bad",
      files: [],
    },
    {
      chooseTargetRoot: async () => emptyRoot,
      downloadUrlToPath: async () => {
        throw new Error("empty folders should not download files");
      },
    },
  );

  assert.equal(emptySummary.successCount, 0);
  assert.equal(emptySummary.failedCount, 0);
  assert.equal(
    fs.existsSync(path.join(emptyRoot, "folder-share-empty_share_bad")),
    true,
  );

  const canceledSummary = await downloadFolderShare(
    {
      folderName: "cancel-me",
      files: [
        {
          relativePath: "a.txt",
          fileName: "a.txt",
          sourceUrl: "https://example.test/a.txt",
        },
      ],
    },
    {
      chooseTargetRoot: async () => undefined,
      downloadUrlToPath: async () => {
        throw new Error("canceled downloads should not start");
      },
    },
  );

  assert.equal(canceledSummary.canceled, true);
  assert.equal(canceledSummary.successCount, 0);
  assert.equal(canceledSummary.failedCount, 0);

  console.log("folderShareDownload tests passed");
})();

export {};
