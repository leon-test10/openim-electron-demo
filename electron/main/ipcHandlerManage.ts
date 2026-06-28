import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import {
  clearCache,
  closeWindow,
  minimize,
  showWindow,
  splashEnd,
  updateMaximize,
} from "./windowManage";
import { t } from "i18next";
import { IpcRenderToMain } from "../constants";
import { getStore } from "./storeManage";
import { changeLanguage } from "../i18n";
import { runtimeManager } from "./runtimeManage";
import { terminalManager } from "./terminalManage";
import { agentWatchManager } from "./agentWatchManage";
import { opencodeManager } from "./opencodeManage";
import {
  copyFileToTerminalWorkspace,
  downloadFileToTerminalWorkspace,
  getConversationWorkspaceDir,
  getTerminalWorkspaceDir,
  scanNativeFolder,
  scanWorkspaceFolder,
  statWorkspaceFile,
  writeFileToConversationWorkspace,
  writeFileToTerminalWorkspace,
} from "./workspaceManage";

const store = getStore();

const sanitizeDownloadFileName = (fileName: string) =>
  fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "download";

const downloadUrlToPath = (
  url: URL,
  targetPath: string,
  redirectCount = 0,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        if (redirectCount >= 3) {
          reject(new Error("Too many attachment redirects"));
          return;
        }
        downloadUrlToPath(
          new URL(response.headers.location, url),
          targetPath,
          redirectCount + 1,
        )
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      fs.promises
        .mkdir(path.dirname(targetPath), { recursive: true })
        .then(() => {
          const file = fs.createWriteStream(targetPath);
          response.pipe(file);
          file.on("finish", () => {
            file.close((error) => {
              if (error) reject(error);
              else resolve(targetPath);
            });
          });
          file.on("error", (error) => {
            fs.promises.rm(targetPath, { force: true }).finally(() => reject(error));
          });
        })
        .catch(reject);
    });
    request.on("error", reject);
    request.setTimeout(60_000, () => {
      request.destroy(new Error("Download timed out"));
    });
  });

const downloadUrlToLocalFile = async (params: {
  sourceUrl: string;
  fileName: string;
  saveAs?: boolean;
}) => {
  const url = new URL(params.sourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) file URLs can be downloaded");
  }

  const downloadsDir = app.getPath("downloads");
  const parsedName = path.parse(sanitizeDownloadFileName(params.fileName));
  const defaultPath = path.join(
    downloadsDir,
    params.saveAs
      ? `${parsedName.name || "download"}${parsedName.ext}`
      : `${parsedName.name || "download"}-${Date.now()}${parsedName.ext}`,
  );
  const saveResult = params.saveAs
    ? await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
        defaultPath,
      })
    : undefined;
  if (saveResult?.canceled) {
    throw new Error("Save cancelled");
  }
  const targetPath = saveResult?.filePath ?? defaultPath;
  return downloadUrlToPath(url, targetPath);
};

const sanitizeRelativeDownloadPath = (relativePath: string, fallbackName: string) => {
  const safeParts = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => sanitizeDownloadFileName(part))
    .filter(Boolean);
  return safeParts.length > 0 ? safeParts.join(path.sep) : sanitizeDownloadFileName(fallbackName);
};

export const setIpcMainListener = () => {
  ipcMain.handle(IpcRenderToMain.clearSession, () => {
    clearCache();
  });

  // window manage
  ipcMain.handle("changeLanguage", (_, locale) => {
    store.set("language", locale);
    changeLanguage(locale).then(() => {
      app.relaunch();
      app.exit(0);
    });
  });
  ipcMain.handle("main-win-ready", () => {
    splashEnd();
  });
  ipcMain.handle(IpcRenderToMain.showMainWindow, () => {
    showWindow();
  });
  ipcMain.handle(IpcRenderToMain.minimizeWindow, () => {
    minimize();
  });
  ipcMain.handle(IpcRenderToMain.maxmizeWindow, () => {
    updateMaximize();
  });
  ipcMain.handle(IpcRenderToMain.closeWindow, () => {
    closeWindow();
  });
  ipcMain.handle(IpcRenderToMain.showMessageBox, (_, options) => {
    return dialog
      .showMessageBox(BrowserWindow.getFocusedWindow(), options)
      .then((res) => res.response);
  });

  // data transfer
  ipcMain.handle(IpcRenderToMain.setKeyStore, (_, { key, data }) => {
    store.set(key, data);
  });
  ipcMain.handle(IpcRenderToMain.getKeyStore, (_, { key }) => {
    return store.get(key);
  });
  ipcMain.on(IpcRenderToMain.getKeyStoreSync, (e, { key }) => {
    e.returnValue = store.get(key);
  });
  ipcMain.handle(IpcRenderToMain.showInputContextMenu, () => {
    const menu = Menu.buildFromTemplate([
      {
        label: t("system.copy"),
        type: "normal",
        role: "copy",
        accelerator: "CommandOrControl+c",
      },
      {
        label: t("system.paste"),
        type: "normal",
        role: "paste",
        accelerator: "CommandOrControl+v",
      },
      {
        label: t("system.selectAll"),
        type: "normal",
        role: "selectAll",
        accelerator: "CommandOrControl+a",
      },
    ]);
    menu.popup({
      window: BrowserWindow.getFocusedWindow()!,
    });
  });
  ipcMain.handle(IpcRenderToMain.runtimeListProfiles, () => {
    return runtimeManager.listProfiles();
  });
  ipcMain.handle(IpcRenderToMain.runtimeHealthCheck, (_, profileID) => {
    return runtimeManager.healthCheck(profileID);
  });
  ipcMain.handle(IpcRenderToMain.runtimeStart, (event, params) => {
    return runtimeManager.start(event.sender, params);
  });
  ipcMain.handle(IpcRenderToMain.runtimeInterrupt, (_, attachmentID) => {
    return runtimeManager.interrupt(attachmentID);
  });
  ipcMain.handle(IpcRenderToMain.runtimeStop, (_, attachmentID) => {
    return runtimeManager.stop(attachmentID);
  });
  ipcMain.handle(IpcRenderToMain.runtimeWriteInput, (_, params) => {
    return runtimeManager.writeInput(params);
  });
  ipcMain.handle(IpcRenderToMain.runtimeResize, (_, params) => {
    return runtimeManager.resize(params);
  });
  ipcMain.handle(IpcRenderToMain.terminalStart, (event, params) => {
    return terminalManager.start(event.sender, params);
  });
  ipcMain.handle(IpcRenderToMain.terminalInterrupt, (_, tabID) => {
    return terminalManager.interrupt(tabID);
  });
  ipcMain.handle(IpcRenderToMain.terminalStop, (_, tabID) => {
    return terminalManager.stop(tabID);
  });
  ipcMain.handle(IpcRenderToMain.terminalWrite, (_, params) => {
    return terminalManager.write(params);
  });
  ipcMain.handle(IpcRenderToMain.terminalResize, (_, params) => {
    return terminalManager.resize(params);
  });

  ipcMain.handle(IpcRenderToMain.fileSelectFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return Promise.all(
      result.filePaths.map(async (filePath) => {
        try {
          const stat = await fs.promises.stat(filePath);
          return {
            nativePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stat.size,
            mimeType: undefined,
          };
        } catch {
          return null;
        }
      }),
    ).then((files) => files.filter((f): f is NonNullable<typeof f> => f !== null));
  });
  ipcMain.handle(IpcRenderToMain.fileSelectFolder, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return undefined;
    const folderPath = result.filePaths[0];
    return {
      folderPath,
      folderName: path.basename(folderPath),
    };
  });

  ipcMain.handle(
    IpcRenderToMain.fileStatNativePath,
    async (_, nativePath: string) => {
      try {
        const stat = await fs.promises.stat(nativePath);
        return {
          exists: true,
          isFile: stat.isFile(),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      } catch {
        return { exists: false, isFile: false, size: 0, mtimeMs: 0 };
      }
    },
  );
  ipcMain.handle(IpcRenderToMain.fileOpenPath, async (_, nativePath: string) => {
    return shell.openPath(nativePath);
  });
  ipcMain.handle(
    IpcRenderToMain.fileShowItemInFolder,
    async (_, nativePath: string) => {
      shell.showItemInFolder(nativePath);
      return true;
    },
  );
  ipcMain.handle(
    IpcRenderToMain.fileDownloadToLocal,
    async (_, params: { sourceUrl: string; fileName: string }) => {
      return downloadUrlToLocalFile(params);
    },
  );
  ipcMain.handle(
    IpcRenderToMain.folderDownloadAllResources,
    async (
      _,
      params: {
        folderName: string;
        files: Array<{
          relativePath: string;
          fileName: string;
          sourceUrl?: string;
        }>;
      },
    ) => {
      const downloadsDir = app.getPath("downloads");
      const rootDir = path.join(
        downloadsDir,
        `${sanitizeDownloadFileName(params.folderName)}-${Date.now()}`,
      );
      for (const file of params.files) {
        if (!file.sourceUrl) continue;
        const sourceUrl = new URL(file.sourceUrl);
        const relativePath = sanitizeRelativeDownloadPath(
          file.relativePath,
          file.fileName,
        );
        await downloadUrlToPath(sourceUrl, path.join(rootDir, relativePath));
      }
      return rootDir;
    },
  );
  ipcMain.handle(IpcRenderToMain.terminalGetWorkspaceDir, (_, workspaceID) => {
    return getTerminalWorkspaceDir(workspaceID);
  });
  ipcMain.handle(IpcRenderToMain.terminalOpenWorkspace, async (_, workspaceID) => {
    const workspaceDir = await getTerminalWorkspaceDir(workspaceID);
    return shell.openPath(workspaceDir);
  });

  ipcMain.handle(IpcRenderToMain.agentStartWatch, (event, workspaceID) => {
    return agentWatchManager.start(event.sender, workspaceID);
  });
  ipcMain.handle(IpcRenderToMain.agentStopWatch, (_, workspaceID) => {
    return agentWatchManager.stop(workspaceID);
  });
  ipcMain.handle(IpcRenderToMain.opencodeProbeServer, (_, params) => {
    return opencodeManager.probeServer(params);
  });
  ipcMain.handle(IpcRenderToMain.opencodeStartServer, (_, params) => {
    return opencodeManager.startServer(params);
  });
  ipcMain.handle(IpcRenderToMain.opencodeStopServer, (_, workspaceID) => {
    return opencodeManager.stopServer(workspaceID);
  });
  ipcMain.handle(IpcRenderToMain.opencodeGetBinding, (_, workspaceID) => {
    return opencodeManager.getBinding(workspaceID);
  });

  ipcMain.handle(IpcRenderToMain.workspaceGetConversationDir, (_, conversationID) => {
    return getConversationWorkspaceDir(conversationID);
  });
  ipcMain.handle(IpcRenderToMain.workspaceWriteFile, (_, params) => {
    return writeFileToConversationWorkspace(params);
  });
  ipcMain.handle(IpcRenderToMain.workspaceWriteWorkspaceFile, (_, params) => {
    return writeFileToTerminalWorkspace(params);
  });
  ipcMain.handle(IpcRenderToMain.workspaceCopyWorkspaceFile, (_, params) => {
    return copyFileToTerminalWorkspace(params);
  });
  ipcMain.handle(IpcRenderToMain.workspaceDownloadWorkspaceFile, (_, params) => {
    return downloadFileToTerminalWorkspace(params);
  });
  ipcMain.handle(
    IpcRenderToMain.workspaceStatFile,
    (_, workspaceID: string, relativePath: string) => {
      return statWorkspaceFile(workspaceID, relativePath);
    },
  );
  ipcMain.handle(IpcRenderToMain.folderScan, (_, params) => {
    if (params?.nativePath) {
      return scanNativeFolder(params);
    }
    return scanWorkspaceFolder(params);
  });
  ipcMain.on(IpcRenderToMain.getDataPath, (e, key: string) => {
    switch (key) {
      case "public":
        e.returnValue = global.pathConfig.publicPath;
        break;
      case "sdkResources":
        e.returnValue = global.pathConfig.sdkResourcesPath;
        break;
      case "logsPath":
        e.returnValue = global.pathConfig.logsPath;
        break;
      default:
        e.returnValue = global.pathConfig.publicPath;
        break;
    }
  });
};
