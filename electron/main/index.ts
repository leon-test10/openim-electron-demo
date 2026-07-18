import { app } from "electron";
import { join } from "node:path";
import { createMainWindow } from "./windowManage";
import { createTray } from "./trayManage";
import { setIpcMainListener } from "./ipcHandlerManage";
import { setAppGlobalData, setAppListener, setSingleInstance } from "./appManage";
import createAppMenu from "./menuManage";
import { isLinux } from "../utils";
import { getLogger } from "../utils/log";
import { initI18n } from "../i18n";
import { initializeAgentGateway } from "./agentGatewayBootstrap";

const isE2EMode = process.env.E2E_MODE === "1";

if (isE2EMode) {
  app.setPath("userData", join(app.getPath("temp"), "openim-electron-demo-e2e"));
}

export const logger = getLogger(join(app.getPath("userData"), `/OpenIMData/logs`));

const init = () => {
  initI18n();
  createMainWindow();
  createAppMenu();
  if (!isE2EMode) {
    createTray();
  }
};

setAppGlobalData();
setIpcMainListener();
if (!isE2EMode) {
  setSingleInstance();
}
setAppListener(init);

app.whenReady().then(async () => {
  try {
    const gateway = await initializeAgentGateway();
    logger.info("Agent Gateway initialized", gateway);
  } catch (error) {
    logger.error("Agent Gateway initialization failed", error);
  }
  isLinux ? setTimeout(init, 300) : init();
});
