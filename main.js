const path = require("path");
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");

const WINDOW_PRESETS = {
  compact: { width: 140, height: 140 },
  expanded: { width: 520, height: 560 },
};

let mainWindow = null;

function getBottomRightBounds(win, preset) {
  const target = WINDOW_PRESETS[preset] || WINDOW_PRESETS.compact;
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  return {
    width: target.width,
    height: target.height,
    x: Math.round(area.x + area.width - target.width),
    y: Math.round(area.y + area.height - target.height),
  };
}

function applyWindowPreset(win, preset) {
  if (!win || win.isDestroyed()) return;
  const bounds = getBottomRightBounds(win, preset);
  win.setBounds(bounds, false);
}

function createMainWindow() {
  const initial = WINDOW_PRESETS.compact;
  const workArea = screen.getPrimaryDisplay().workArea;
  const x = Math.round(workArea.x + workArea.width - initial.width);
  const y = Math.round(workArea.y + workArea.height - initial.height);

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
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

ipcMain.on("set-window-preset", (_event, preset) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  applyWindowPreset(mainWindow, preset);
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
