const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  setPassthrough(passthrough) {
    ipcRenderer.send("set-passthrough", Boolean(passthrough));
  },
  showContextMenu() {
    ipcRenderer.send("show-context-menu");
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
  writeClipboard(text) {
    return ipcRenderer.invoke("write-clipboard", text);
  },
  exportTexts(payload) {
    return ipcRenderer.invoke("export-texts", payload);
  },
  importTexts() {
    return ipcRenderer.invoke("import-texts");
  },
});
