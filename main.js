const path = require("path");
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");

let mainWindow = null;

function createMainWindow() {
  const width = 520;
  const height = 560;
  const workArea = screen.getPrimaryDisplay().workArea;
  const x = Math.round(workArea.x + workArea.width - width);
  const y = Math.round(workArea.y + workArea.height - height);

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    title: "悬浮文案球复制器",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.on("set-mouse-passthrough", (_event, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
