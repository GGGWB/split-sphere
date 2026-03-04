const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  setMousePassthrough(ignore) {
    ipcRenderer.send("set-mouse-passthrough", Boolean(ignore));
  },
});
