import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from "electron";
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
import {
  getConversationWorkspaceDir,
  getTerminalWorkspaceDir,
  writeFileToConversationWorkspace,
  writeFileToTerminalWorkspace,
} from "./workspaceManage";

const store = getStore();

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
  ipcMain.handle(IpcRenderToMain.terminalGetWorkspaceDir, (_, workspaceID) => {
    return getTerminalWorkspaceDir(workspaceID);
  });
  ipcMain.handle(IpcRenderToMain.terminalOpenWorkspace, async (_, workspaceID) => {
    const workspaceDir = await getTerminalWorkspaceDir(workspaceID);
    return shell.openPath(workspaceDir);
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
