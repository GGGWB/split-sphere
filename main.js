const path = require("path");
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");

let mainWindow = null;
let interactionLocked = false;
let passthroughTimer = null;
let ignoreState = null;
const CENTER_HOTZONE_SIZE = 84;

function setIgnoreMouseEvents(ignore) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (ignoreState === ignore) return;
  ignoreState = ignore;
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function isCursorInCenterHotzone() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const p = screen.getCursorScreenPoint();
  const b = mainWindow.getBounds();
  return (
    p.x >= b.x + b.width - CENTER_HOTZONE_SIZE &&
    p.x <= b.x + b.width &&
    p.y >= b.y + b.height - CENTER_HOTZONE_SIZE &&
    p.y <= b.y + b.height
  );
}

function refreshMouseMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (interactionLocked) {
    setIgnoreMouseEvents(false);
    return;
  }
  setIgnoreMouseEvents(!isCursorInCenterHotzone());
}

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

  if (passthroughTimer) clearInterval(passthroughTimer);
  passthroughTimer = setInterval(refreshMouseMode, 16);
  mainWindow.on("closed", () => {
    if (passthroughTimer) clearInterval(passthroughTimer);
    passthroughTimer = null;
    mainWindow = null;
    ignoreState = null;
  });
  mainWindow.on("move", refreshMouseMode);
  mainWindow.on("resize", refreshMouseMode);
  refreshMouseMode();
}

ipcMain.on("set-interaction-lock", (_event, locked) => {
  interactionLocked = Boolean(locked);
  refreshMouseMode();
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
