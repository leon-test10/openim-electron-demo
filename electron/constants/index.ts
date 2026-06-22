export const IpcMainToRender = {
  appResume: "appResume",
  runtimeEvent: "runtime:event",
};

export const IpcRenderToMain = {
  showMainWindow: "showMainWindow",
  clearSession: "clearSession",
  minimizeWindow: "minimizeWindow",
  maxmizeWindow: "maxmizeWindow",
  closeWindow: "closeWindow",
  showMessageBox: "showMessageBox",
  setKeyStore: "setKeyStore",
  getKeyStore: "getKeyStore",
  getKeyStoreSync: "getKeyStoreSync",
  showInputContextMenu: "showInputContextMenu",
  getDataPath: "getDataPath",
  runtimeListProfiles: "runtime:listProfiles",
  runtimeStart: "runtime:start",
  runtimeInterrupt: "runtime:interrupt",
  runtimeStop: "runtime:stop",
  runtimeWriteInput: "runtime:writeInput",
  runtimeResize: "runtime:resize",
  runtimeHealthCheck: "runtime:healthCheck",

  workspaceGetConversationDir: "workspace:getConversationDir",
  workspaceWriteFile: "workspace:writeFile",
};
