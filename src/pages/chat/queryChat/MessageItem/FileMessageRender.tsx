import { FC } from "react";

import { formatBr } from "@/utils/common";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

const FileMessageRender: FC<IMessageItemProps> = ({ message }) => {
  const fileElem = message.fileElem;
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
  const sizeText =
    fileSize > 0
      ? fileSize > 1024 * 1024
        ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
        : `${(fileSize / 1024).toFixed(0)} KB`
      : "";

  const handleOpen = () => {
    if (sourceUrl) {
      window.open(sourceUrl, "_blank");
    }
  };

  return (
    <div className={styles.bubble}>
      <div
        className="flex cursor-pointer items-center gap-2 rounded border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 hover:bg-[#f0f5ff]"
        onClick={handleOpen}
        title={sourceUrl || fileName}
      >
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
          <div className="truncate text-sm font-medium text-[#1d2939]">{fileName}</div>
          {sizeText && <div className="text-xs text-[#98a2b3]">{sizeText}</div>}
        </div>
      </div>
    </div>
  );
};

export default FileMessageRender;
