const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  openOverlay(mode) {
    if (mode !== "orbit" && mode !== "editor") return;
    ipcRenderer.send("open-overlay", mode);
  },
  closeOverlay() {
    ipcRenderer.send("close-overlay");
  },
  onHostCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("host-command", listener);
    return () => ipcRenderer.removeListener("host-command", listener);
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
