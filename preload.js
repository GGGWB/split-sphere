const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  setInteractionLock(locked) {
    ipcRenderer.send("set-interaction-lock", Boolean(locked));
  },
});
