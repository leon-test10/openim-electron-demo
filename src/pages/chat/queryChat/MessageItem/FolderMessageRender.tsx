import { Button, message as antdMessage, Modal } from "antd";
import { FC, useRef, useState } from "react";

import { parseFolderShareMessage } from "@/utils/folderShare";
import { getLocalFolderShare } from "@/utils/localFolderShareCache";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

type FolderShareDownloadSummary = {
  canceled: boolean;
  folderPath?: string;
  successCount: number;
  failedCount: number;
  failedFiles: Array<{ relativePath: string; reason: string }>;
};

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const joinLocalFolderPath = (rootPath: string, relativePath: string) => {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(
    /[\\/]+/g,
    separator,
  )}`;
};

const FolderMessageRender: FC<IMessageItemProps> = ({ message }) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const downloadInFlightRef = useRef(false);
  const manifest = parseFolderShareMessage(message);

  if (!manifest) {
    return (
      <div className={styles.bubble}>
        <span className="text-gray-500">[Folder message - invalid data]</span>
      </div>
    );
  }

  const localFolder = getLocalFolderShare(manifest.shareID);

  const openFolder = async () => {
    if (!localFolder?.nativePath) {
      setViewerOpen(true);
      return;
    }
    await window.electronAPI?.ipcInvoke("file:openPath", localFolder.nativePath);
  };

  const downloadFile = async (file: (typeof manifest.files)[number]) => {
    if (!file.sourceUrl) {
      antdMessage.warning("This folder item is missing a download URL.");
      return;
    }
    if (!window.electronAPI) {
      const link = document.createElement("a");
      link.href = file.sourceUrl;
      link.download = file.fileName;
      link.click();
      return;
    }
    await window.electronAPI.ipcInvoke("file:downloadToLocal", {
      sourceUrl: file.sourceUrl,
      fileName: file.fileName,
    });
    antdMessage.success("File downloaded");
  };

  const openFile = async (file: (typeof manifest.files)[number]) => {
    if (!localFolder?.nativePath) {
      await downloadFile(file);
      return;
    }
    await window.electronAPI?.ipcInvoke(
      "file:openPath",
      joinLocalFolderPath(localFolder.nativePath, file.relativePath),
    );
  };

  const downloadAll = async () => {
    if (downloadInFlightRef.current) return;
    downloadInFlightRef.current = true;
    if (!window.electronAPI) {
      const downloadableFiles = manifest.files.filter((file) => file.sourceUrl);
      if (downloadableFiles.length === 0) {
        downloadInFlightRef.current = false;
        antdMessage.warning("This folder has no downloadable resources.");
        return;
      }
      try {
        await Promise.all(downloadableFiles.map((file) => downloadFile(file)));
      } finally {
        downloadInFlightRef.current = false;
      }
      return;
    }
    setDownloadLoading(true);
    try {
      const summary = await window.electronAPI.ipcInvoke<FolderShareDownloadSummary>(
        "folder:downloadShare",
        manifest,
      );
      if (summary.canceled) return;
      if (summary.failedCount > 0) {
        console.warn("[folder-share] download partial failures", summary.failedFiles);
        antdMessage.warning(
          `Folder downloaded with ${summary.failedCount} failure(s).`,
        );
        return;
      }
      antdMessage.success("Folder downloaded successfully");
      if (summary.folderPath) {
        await window.electronAPI.ipcInvoke("file:openPath", summary.folderPath);
      }
    } catch (error) {
      antdMessage.error(
        error instanceof Error ? error.message : "Folder download failed",
      );
    } finally {
      downloadInFlightRef.current = false;
      setDownloadLoading(false);
    }
  };

  return (
    <div className={styles.bubble}>
      <div className="w-[360px] max-w-full rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-14 shrink-0 items-center justify-center rounded-md bg-[#4dabf7]">
            <svg width="34" height="28" viewBox="0 0 34 28" fill="none">
              <path
                d="M2 5.5A3.5 3.5 0 0 1 5.5 2H14l3 4h11.5A3.5 3.5 0 0 1 32 9.5v13A3.5 3.5 0 0 1 28.5 26h-23A3.5 3.5 0 0 1 2 22.5v-17Z"
                fill="#56B6FF"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-[#101828]">
              {manifest.folderName}({manifest.itemCount})
            </div>
            <div className="text-sm text-[#98a2b3]">
              {formatBytes(manifest.totalSize)}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Button
            shape="round"
            size="large"
            className="bg-[#f2f4f7]"
            onClick={() => void openFolder()}
            data-testid="folder-message-open"
          >
            打开文件夹
          </Button>
          <Button
            shape="round"
            size="large"
            loading={downloadLoading}
            disabled={downloadLoading}
            onClick={() => void downloadAll()}
            data-testid="folder-message-download-share"
          >
            Download Folder
          </Button>
        </div>
      </div>
      <Modal
        title={manifest.folderName}
        open={viewerOpen}
        onCancel={() => setViewerOpen(false)}
        footer={null}
      >
        <div className="mb-3 text-sm text-[#667085]">
          {manifest.itemCount} files - {formatBytes(manifest.totalSize)}
        </div>
        <div className="mb-3 flex justify-end">
          <Button
            loading={downloadLoading}
            disabled={downloadLoading}
            onClick={() => void downloadAll()}
            data-testid="folder-message-download-all"
          >
            下载全部
          </Button>
        </div>
        <div className="max-h-[360px] overflow-auto rounded border border-[#e5e7eb]">
          {manifest.files.map((file) => (
            <div
              key={file.relativePath}
              className="flex items-center justify-between border-b border-[#f2f4f7] px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
              <span className="ml-3 shrink-0 text-xs text-[#98a2b3]">
                {formatBytes(file.size)}
              </span>
              <Button
                type="link"
                size="small"
                onClick={() => void openFile(file)}
                data-testid="folder-message-open-file"
              >
                打开
              </Button>
              <Button
                type="link"
                size="small"
                disabled={!file.sourceUrl}
                onClick={() => void downloadFile(file)}
                data-testid="folder-message-download-file"
              >
                下载
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default FolderMessageRender;
