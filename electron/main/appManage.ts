import { join } from "node:path";

import { app, powerMonitor } from "electron";
import fs from "fs";

import { IpcMainToRender } from "../constants";
import { isMac, isProd, isWin } from "../utils";
import { logger } from ".";
import { stopAgentCollaborationBridge } from "./agentGatewayBootstrap";
import { agentGatewayManager } from "./agentGatewayManage";
import { agentSessionManager } from "./agentSessionManage";
import { agentWatchManager } from "./agentWatchManage";
import { getUserConfigPath, loadAppConfig } from "./appConfig";
import { ensureBundledOpencodeCommand } from "./opencodeBundleManage";
import { ensureOpencodeConfigFile } from "./opencodeConfigManage";
import { opencodeManager } from "./opencodeManage";
import { getStore } from "./storeManage";
import { isExistMainWindow, sendEvent, showWindow } from "./windowManage";

const store = getStore();

export const setSingleInstance = () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }

  app.on("second-instance", () => {
    showWindow();
  });
};

export const setAppListener = (startApp: () => void) => {
  let shutdownStarted = false;
  let shutdownComplete = false;
  app.on("activate", () => {
    if (isExistMainWindow()) {
      showWindow();
    } else {
      startApp();
    }
  });

  app.on("window-all-closed", () => {
    if (isMac && !getIsForceQuit()) return;
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    agentWatchManager.stopAll();
    stopAgentCollaborationBridge();
    void Promise.allSettled([
      agentSessionManager.stop(),
      agentGatewayManager.stop(),
    ]).finally(() => {
      opencodeManager.stopAll();
      shutdownComplete = true;
      app.quit();
    });
  });

  powerMonitor.on("suspend", () => {
    logger.debug("app suspend");
  });

  powerMonitor.on("resume", () => {
    logger.debug("app resume");
    sendEvent(IpcMainToRender.appResume);
  });
};

export const setAppGlobalData = () => {
  const electronDistPath = join(__dirname, "../");
  const distPath = join(electronDistPath, "../dist");
  const publicPath = isProd ? distPath : join(electronDistPath, "../public");
  const asarPath = process.resourcesPath;
  const defaultConfigPath = isProd
    ? join(asarPath, "extraResources", "default-config.json")
    : join(electronDistPath, "../extraResources/default-config.json");
  const defaultOpencodeConfigPath = isProd
    ? join(asarPath, "extraResources", "opencode", "default-opencode.jsonc")
    : join(electronDistPath, "../extraResources/opencode/default-opencode.jsonc");
  const bundledOpencodeArchivePath = isProd
    ? join(asarPath, "extraResources", "opencode", "opencode-windows-x64.zip")
    : join(electronDistPath, "../extraResources/opencode/opencode-windows-x64.zip");
  const bundledOpencodePath = ensureBundledOpencodeCommand({
    archivePath: bundledOpencodeArchivePath,
    installDir: join(app.getPath("userData"), "OpenCode", "bin"),
  });
  const userConfigPath = getUserConfigPath(app.getPath("userData"));

  app.setName("OpenIM Agent");
  const appConfig = loadAppConfig({
    userDataPath: app.getPath("userData"),
    defaultConfigPath,
    bundledOpencodePath,
  });
  ensureOpencodeConfigFile({
    targetDir: join(app.getPath("appData"), "opencode"),
    defaultTemplatePath: defaultOpencodeConfigPath,
    config: appConfig.opencode.workspaceConfig,
  });

  global.pathConfig = {
    electronDistPath,
    distPath,
    publicPath,
    asarPath,
    logsPath: join(app.getPath("userData"), `/OpenIMData/logs`),
    sdkResourcesPath: join(app.getPath("userData"), `/OpenIMData/sdkResources`),
    imsdkLibPath: isProd
      ? join(
          asarPath,
          "/app.asar.unpacked/node_modules/@openim/electron-client-sdk/assets",
        )
      : join(__dirname, "../../node_modules/@openim/electron-client-sdk/assets"),
    trayIcon: join(publicPath, `/icons/${isWin ? "icon.ico" : "tray.png"}`),
    emptyTrayIcon: join(publicPath, `/icons/${"empty_tray.png"}`),
    indexHtml: join(distPath, "index.html"),
    splashHtml: join(distPath, "splash.html"),
    preload: join(__dirname, "../preload/index.js"),
    defaultConfigPath,
    userConfigPath,
  };

  if (isProd) {
    fs.promises
      .readdir(global.pathConfig.logsPath)
      .catch(
        (err) =>
          err.code === "ENOENT" &&
          fs.promises.mkdir(global.pathConfig.logsPath, { recursive: true }),
      );
    fs.promises
      .readdir(global.pathConfig.sdkResourcesPath)
      .catch(
        (err) =>
          err.code === "ENOENT" &&
          fs.promises.mkdir(global.pathConfig.sdkResourcesPath, { recursive: true }),
      );
  }
};

export const getIsForceQuit = () =>
  store.get("closeAction") === "quit" || global.forceQuit;
