export const FOLDER_SHARE_TYPE = "openim-agent.folder-share";
export const FOLDER_SHARE_SCHEMA = "openim-agent.folder-share.v1";

export type FolderShareFile = {
  relativePath: string;
  fileName: string;
  size: number;
  mimeType?: string;
  sourceUrl?: string;
  uuid?: string;
};

export type FolderShareManifest = {
  schema: typeof FOLDER_SHARE_SCHEMA;
  shareID: string;
  folderName: string;
  itemCount: number;
  totalSize: number;
  createdAt: number;
  createdBy?: string;
  files: FolderShareFile[];
};

export type FolderShareCustomData = {
  type: typeof FOLDER_SHARE_TYPE;
  version: 1;
  shareID: string;
  folderName: string;
  itemCount: number;
  totalSize: number;
};

export const createFolderSharePayload = (manifest: FolderShareManifest) => ({
  data: JSON.stringify({
    type: FOLDER_SHARE_TYPE,
    version: 1,
    shareID: manifest.shareID,
    folderName: manifest.folderName,
    itemCount: manifest.itemCount,
    totalSize: manifest.totalSize,
  } satisfies FolderShareCustomData),
  extension: JSON.stringify({ manifest }),
  description: `[Folder] ${manifest.folderName}`,
});

export const parseFolderShareMessage = (message: {
  customElem?: { data?: string; extension?: string };
}) => {
  try {
    const data = JSON.parse(message.customElem?.data ?? "{}") as Partial<
      FolderShareCustomData
    >;
    if (data.type !== FOLDER_SHARE_TYPE || data.version !== 1) return undefined;
    const extension = JSON.parse(message.customElem?.extension ?? "{}") as {
      manifest?: FolderShareManifest;
    };
    return extension.manifest;
  } catch {
    return undefined;
  }
};
