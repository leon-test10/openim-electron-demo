import { v4 as uuidV4 } from "uuid";

import { IMSDK } from "@/layout/MainContentWrap";

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
    getImageMessage,
  };
}
