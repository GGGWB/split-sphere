const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");

let anchorWindow = null;
let overlayWindow = null;
let overlayReady = false;
let pendingOverlayCommand = null;
let debugLogPath = "";
let isQuitting = false;

const WINDOW_SIZES = {
  anchor: { width: 96, height: 96 },
  overlay: { width: 520, height: 560 },
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

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function getBottomRightBounds(size) {
  const area = getWorkArea();
  return {
    width: size.width,
    height: size.height,
    x: Math.round(area.x + area.width - size.width),
    y: Math.round(area.y + area.height - size.height),
  };
}

function applyBottomRight(win, size) {
  if (!win || win.isDestroyed()) return;
  const next = getBottomRightBounds(size);
  const before = win.getBounds();
  win.setBounds(next, false);
  appendDebugLog("main", "apply-bottom-right", { before, next });
}

function attachWindowDebug(win, label) {
  if (!win || win.isDestroyed()) return;
  const log = (message, data) => appendDebugLog(label, message, data);

  log("created", { bounds: win.getBounds() });
  win.on("focus", () => log("focus", { bounds: win.getBounds() }));
  win.on("blur", () => log("blur", { bounds: win.getBounds() }));
  win.on("moved", () => log("moved", { bounds: win.getBounds() }));
  win.on("resized", () => log("resized", { bounds: win.getBounds() }));
  win.on("show", () => log("show", { bounds: win.getBounds() }));
  win.on("hide", () => log("hide", { bounds: win.getBounds() }));

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    appendDebugLog("console", `${label}-renderer-console`, { level, message, line, sourceId });
  });
  win.webContents.on("did-start-loading", () => log("did-start-loading"));
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    log("did-fail-load", { code, description, url, isMainFrame });
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    log("preload-error", { preloadPath, error: String(error) });
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log("render-process-gone", details);
  });
  win.webContents.on("dom-ready", () => {
    log("dom-ready");
    const script = `(() => {
      const bridge = window.desktopBridge;
      return {
        readyState: document.readyState,
        mode: new URLSearchParams(window.location.search).get("mode"),
        hasCenterBall: Boolean(document.getElementById("centerBall")),
        hasAppScriptFlag: Boolean(window.__SPLIT_SPHERE_BOOTED__),
        appScriptFlag: window.__SPLIT_SPHERE_BOOTED__ || null,
        hasDesktopBridge: Boolean(bridge),
        bridgeKeys: bridge ? Object.keys(bridge) : []
      };
    })()`;
    win.webContents.executeJavaScript(script, true)
      .then((inspect) => log("dom-inspect", inspect))
      .catch((error) => log("dom-inspect-error", { error: String(error) }));
  });
  win.webContents.on("did-finish-load", () => {
    log("did-finish-load", { bounds: win.getBounds() });
    if (label === "overlay") {
      overlayReady = true;
      if (pendingOverlayCommand) {
        win.webContents.send("host-command", { type: pendingOverlayCommand });
        log("flush-pending-command", { command: pendingOverlayCommand });
        pendingOverlayCommand = null;
      }
    }
  });
}

function createWindow(mode) {
  const size = WINDOW_SIZES[mode];
  const bounds = getBottomRightBounds(size);
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: mode === "anchor",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    title: "悬浮文案球复制器",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  attachWindowDebug(win, mode);
  win.loadFile(path.join(__dirname, "index.html"), { query: { mode } });
  return win;
}

function sendOverlayCommand(type) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayReady || overlayWindow.webContents.isLoadingMainFrame()) {
    pendingOverlayCommand = type;
    appendDebugLog("main", "queue-overlay-command", { type });
    return;
  }
  overlayWindow.webContents.send("host-command", { type });
  appendDebugLog("main", "send-overlay-command", { type });
}

function openOverlay(mode) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !anchorWindow || anchorWindow.isDestroyed()) return;
  const command = mode === "editor" ? "open-editor" : "open-orbit";
  applyBottomRight(anchorWindow, WINDOW_SIZES.anchor);
  applyBottomRight(overlayWindow, WINDOW_SIZES.overlay);
  sendOverlayCommand(command);
  if (anchorWindow.isVisible()) anchorWindow.hide();
  if (!overlayWindow.isVisible()) overlayWindow.show();
  overlayWindow.focus();
  appendDebugLog("main", "open-overlay", { mode, command });
}

function closeOverlay(reason) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !anchorWindow || anchorWindow.isDestroyed()) return;
  if (overlayWindow.isVisible()) overlayWindow.hide();
  applyBottomRight(anchorWindow, WINDOW_SIZES.anchor);
  if (!anchorWindow.isVisible()) anchorWindow.show();
  appendDebugLog("main", "close-overlay", { reason });
}

function repositionWindows() {
  applyBottomRight(anchorWindow, WINDOW_SIZES.anchor);
  applyBottomRight(overlayWindow, WINDOW_SIZES.overlay);
}

function createWindows() {
  overlayReady = false;
  pendingOverlayCommand = null;
  anchorWindow = createWindow("anchor");
  overlayWindow = createWindow("overlay");
  overlayWindow.hide();
  overlayWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    closeOverlay("overlay-window-close-intercept");
  });
}

ipcMain.on("open-overlay", (_event, mode) => {
  openOverlay(mode === "editor" ? "editor" : "orbit");
});

ipcMain.on("close-overlay", () => {
  closeOverlay("renderer-request");
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
  Menu.setApplicationMenu(null);
  createWindows();
  screen.on("display-metrics-changed", repositionWindows);
  screen.on("display-added", repositionWindows);
  screen.on("display-removed", repositionWindows);
  app.on("activate", () => {
    if (
      anchorWindow &&
      !anchorWindow.isDestroyed() &&
      overlayWindow &&
      !overlayWindow.isDestroyed() &&
      !overlayWindow.isVisible()
    ) {
      anchorWindow.show();
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  appendDebugLog("main", "window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
