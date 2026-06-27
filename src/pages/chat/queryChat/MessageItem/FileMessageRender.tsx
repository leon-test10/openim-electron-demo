import { Button, message as antdMessage } from "antd";
import type React from "react";
import { FC, useState } from "react";

import {
  getLocalFileForMessage,
  type LocalFileCacheEntry,
  recordLocalFileForMessage,
} from "@/utils/localFileCache";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

const FileMessageRender: FC<IMessageItemProps> = ({ message }) => {
  const fileElem = message.fileElem;
  const [localEntry, setLocalEntry] = useState<LocalFileCacheEntry | undefined>(() =>
    getLocalFileForMessage(message.clientMsgID),
  );

  if (!fileElem) {
    return (
      <div className={styles.bubble}>
        <span className="text-gray-500">[File message — no file data]</span>
      </div>
    );
  }

  const fileName = fileElem.fileName || "unknown";
  const fileSize = fileElem.fileSize || 0;
  const sourceUrl = fileElem.sourceUrl || "";
  const localPath = localEntry?.nativePath;
  const sizeText =
    fileSize > 0
      ? fileSize > 1024 * 1024
        ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
        : `${(fileSize / 1024).toFixed(0)} KB`
      : "";

  const openLocalPath = async (nativePath: string) => {
    if (!window.electronAPI) return;
    const error = await window.electronAPI.ipcInvoke<string>(
      "file:openPath",
      nativePath,
    );
    if (error) {
      antdMessage.error(error);
    }
  };

  const showInFolder = async (nativePath: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.ipcInvoke("file:showItemInFolder", nativePath);
  };

  const downloadToLocal = async () => {
    if (!sourceUrl) return undefined;
    if (!window.electronAPI) {
      const link = document.createElement("a");
      link.href = sourceUrl;
      link.download = fileName;
      link.click();
      return undefined;
    }

    const nativePath = await window.electronAPI.ipcInvoke<string>(
      "file:downloadToLocal",
      {
        sourceUrl,
        fileName,
      },
    );
    recordLocalFileForMessage(message.clientMsgID, fileName, nativePath);
    setLocalEntry(getLocalFileForMessage(message.clientMsgID));
    antdMessage.success("File downloaded");
    return nativePath;
  };

  const handleOpen = async () => {
    try {
      if (localPath) {
        await openLocalPath(localPath);
        return;
      }
      const downloadedPath = await downloadToLocal();
      if (downloadedPath) {
        await openLocalPath(downloadedPath);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      antdMessage.error(errorMessage || "Failed to open file");
    }
  };

  const handleDownload = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await downloadToLocal();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      antdMessage.error(errorMessage || "Failed to download file");
    }
  };

  const handleShowInFolder = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!localPath) return;
    await showInFolder(localPath);
  };

  return (
    <div className={styles.bubble}>
      <div
        className="flex cursor-pointer flex-col gap-2 rounded border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 hover:bg-[#f0f5ff]"
        onClick={() => void handleOpen()}
        title={localPath || sourceUrl || fileName}
      >
        <div className="flex w-full items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#475467"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[#1d2939]">
              {fileName}
            </div>
            {sizeText && <div className="text-xs text-[#98a2b3]">{sizeText}</div>}
          </div>
        </div>
        <div className="flex w-full gap-2 text-xs">
          {localPath && (
            <Button size="small" onClick={handleShowInFolder}>
              Show in folder
            </Button>
          )}
          {sourceUrl && (
            <Button size="small" onClick={handleDownload}>
              Download
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileMessageRender;
