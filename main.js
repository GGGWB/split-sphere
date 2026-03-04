const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");

let mainWindow = null;
let debugLogPath = "";
const WINDOW_PRESETS = {
  compact: { width: 96, height: 96 },
  expanded: { width: 520, height: 560 },
};

function toSafeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ error: "non-serializable" });
  }
}

function appendDebugLog(scope, message, data) {
  const time = new Date().toISOString();
  const suffix = data === undefined ? "" : ` ${toSafeJson(data)}`;
  const line = `${time} [${scope}] ${message}${suffix}`;
  console.log(line);
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, `${line}\n`, "utf8");
  } catch (_error) {
    // Ignore logging IO failures.
  }
}

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
  const before = win.getBounds();
  const nextBounds = getBottomRightBounds(win, preset);
  appendDebugLog("main", "apply-window-preset", { preset, before, nextBounds });
  win.setBounds(nextBounds, false);
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
  appendDebugLog("main", "create-main-window", { bounds: mainWindow.getBounds() });
  mainWindow.on("focus", () => appendDebugLog("main", "window-focus", { bounds: mainWindow.getBounds() }));
  mainWindow.on("blur", () => appendDebugLog("main", "window-blur", { bounds: mainWindow.getBounds() }));
  mainWindow.on("moved", () => appendDebugLog("main", "window-moved", { bounds: mainWindow.getBounds() }));
  mainWindow.on("resized", () => appendDebugLog("main", "window-resized", { bounds: mainWindow.getBounds() }));
  mainWindow.webContents.on("did-finish-load", () => {
    appendDebugLog("main", "did-finish-load", { bounds: mainWindow.getBounds() });
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.on("set-window-preset", (_event, preset) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  appendDebugLog("main", "ipc-set-window-preset", { preset });
  applyWindowPreset(mainWindow, preset);
});

ipcMain.on("renderer-debug-log", (_event, payload) => {
  if (!payload || typeof payload !== "object") return;
  const type = typeof payload.type === "string" ? payload.type : "event";
  appendDebugLog("renderer", type, payload.data);
});

ipcMain.handle("get-debug-log-path", () => debugLogPath);

ipcMain.handle("get-debug-log-tail", () => {
  if (!debugLogPath) return "";
  try {
    const text = fs.readFileSync(debugLogPath, "utf8");
    const maxChars = 18000;
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch (_error) {
    return "";
  }
});

app.whenReady().then(() => {
  debugLogPath = path.join(app.getPath("userData"), "debug.log");
  appendDebugLog("main", "session-start", {
    pid: process.pid,
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath("userData"),
    logPath: debugLogPath,
  });
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  appendDebugLog("main", "window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
