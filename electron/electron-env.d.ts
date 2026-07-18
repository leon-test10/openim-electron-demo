/// <reference types="vite-electron-plugin/electron-env" />

export {};

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: "true";
  }
}

interface PathConfig {
  electronDistPath: string;
  distPath: string;
  publicPath: string;
  asarPath: string;
  logsPath: string;
  sdkResourcesPath: string;
  imsdkLibPath: string;
  trayIcon: string;
  emptyTrayIcon: string;
  indexHtml: string;
  splashHtml: string;
  preload: string;
  defaultConfigPath: string;
  userConfigPath: string;
}

declare global {
  // eslint-disable-next-line no-var
  var pathConfig: PathConfig;
  // eslint-disable-next-line no-var
  var forceQuit: boolean | undefined;
}
