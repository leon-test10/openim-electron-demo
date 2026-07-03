import { v4 as uuidV4 } from "uuid";

import { IMSDK } from "@/layout/MainContentWrap";
import {
  createFolderSharePayload,
  FOLDER_SHARE_SCHEMA,
  type FolderShareFile,
  type FolderShareManifest,
} from "@/utils/folderShare";

export interface FileWithPath extends File {
  path?: string;
}

export type LocalFileInput =
  | File
  | {
      nativePath: string;
      fileName: string;
      fileSize?: number;
      mimeType?: string;
    };

export type FolderScanInput = {
  nativePath: string;
  folderName: string;
  itemCount: number;
  totalSize: number;
  files: Array<FolderShareFile & { nativePath?: string }>;
  createdBy?: string;
};

const joinNativeFolderPath = (rootPath: string, relativePath: string) => {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(
    /[\\/]+/g,
    separator,
  )}`;
};

export function useFileMessage() {
  const getImageMessage = async (input: LocalFileInput) => {
    const isFile = input instanceof File;
    const nativePath = isFile ? (input as FileWithPath).path : input.nativePath;

    if (window.electronAPI && nativePath) {
      const imageMessage = (await IMSDK.createImageMessageFromFullPath(nativePath))
        .data;
      const baseUrl = URL.createObjectURL(
        new Blob([], {
          type: isFile ? input.type : input.mimeType ?? "image/png",
        }),
      );
      imageMessage.pictureElem!.sourcePicture.url = baseUrl;
      return imageMessage;
    }

    const file = isFile ? input : new File([], input.fileName);
    const picInfo = await getPicInfo(file);
    const baseInfo = {
      uuid: uuidV4(),
      type: file.type || "image/png",
      size: file.size,
      width: picInfo.width,
      height: picInfo.height,
      url: URL.createObjectURL(file),
    };

    return (
      await IMSDK.createImageMessageByFile({
        sourcePicture: baseInfo,
        bigPicture: baseInfo,
        snapshotPicture: baseInfo,
        sourcePath: "",
        file,
      })
    ).data;
  };

  const getFileMessage = async (input: LocalFileInput) => {
    const isFile = input instanceof File;
    const nativePath = isFile ? (input as FileWithPath).path : input.nativePath;
    const fileName = isFile ? input.name : input.fileName;

    if (window.electronAPI && nativePath) {
      const message = (
        await IMSDK.createFileMessageFromFullPath({
          filePath: nativePath,
          fileName,
        })
      ).data;
      const fileSize = isFile ? input.size : input.fileSize;
      if (message.fileElem && typeof fileSize === "number") {
        message.fileElem.fileSize = fileSize;
      }
      return message;
    }

    const file = isFile ? input : new File([], fileName);
    return (
      await IMSDK.createFileMessageByFile({
        filePath: "",
        fileName,
        uuid: uuidV4(),
        sourceUrl: URL.createObjectURL(file),
        fileSize: file.size,
        fileType: file.type,
        file,
      })
    ).data;
  };

  const getFolderMessage = async (input: FolderScanInput) => {
    const shareID = uuidV4();
    const files = await Promise.all(
      input.files.map(async (file) => {
        const { nativePath: fileNativePath, ...shareFile } = file;
        if (shareFile.sourceUrl) return shareFile;
        const uuid = uuidV4();
        const response = await IMSDK.uploadFile({
          name: shareFile.fileName,
          contentType: shareFile.mimeType ?? "application/octet-stream",
          uuid,
          cause: "folder-share",
          filepath:
            fileNativePath ??
            joinNativeFolderPath(input.nativePath, shareFile.relativePath),
        });
        return {
          ...shareFile,
          sourceUrl: response.data.url,
          uuid,
        };
      }),
    );
    const manifest: FolderShareManifest = {
      schema: FOLDER_SHARE_SCHEMA,
      shareID,
      folderName: input.folderName,
      itemCount: input.itemCount,
      totalSize: input.totalSize,
      createdAt: Date.now(),
      createdBy: input.createdBy,
      files,
    };
    return (await IMSDK.createCustomMessage(createFolderSharePayload(manifest))).data;
  };

  const getPicInfo = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve) => {
      const _URL = window.URL || window.webkitURL;
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.src = _URL.createObjectURL(file);
    });

  return {
    getFileMessage,
    getFolderMessage,
    getImageMessage,
  };
}
