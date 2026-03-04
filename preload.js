const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  setWindowPreset(preset) {
    if (preset !== "compact" && preset !== "expanded") return;
    ipcRenderer.send("set-window-preset", preset);
  },
  logDebug(type, data) {
    if (typeof type !== "string" || !type) return;
    ipcRenderer.send("renderer-debug-log", { type, data });
  },
  getDebugLogPath() {
    return ipcRenderer.invoke("get-debug-log-path");
  },
  getDebugLogTail() {
    return ipcRenderer.invoke("get-debug-log-tail");
  },
});
