const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  setWindowPreset(preset) {
    if (preset !== "compact" && preset !== "expanded") return;
    ipcRenderer.send("set-window-preset", preset);
  },
});
