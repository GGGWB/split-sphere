const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  screen,
  Tray,
  nativeImage,
  clipboard,
  dialog,
} = require("electron");

// ===== 单实例锁 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// 单窗口常驻：窗口恒为 640x640 且透明，靠 setIgnoreMouseEvents 控制是否拦截鼠标。
// 原先 anchor(96x96) 与 overlay(640x640) 相互 hide/show 切换，是右下角主球闪烁的根因。
const WINDOW_SIZE = { width: 640, height: 640 };
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_FLUSH_MS = 400;
// setAlwaysOnTop 会引发 Z 序重排与窗口重绘，过于频繁会造成闪烁，故做节流
const PIN_THROTTLE_MS = 800;
const TRAY_ICON_PATH = path.join(__dirname, "tray-icon.png");

let mainWindow = null;
let ready = false;
let pendingCommand = null;
let debugLogPath = "";
let debugEnabled = false;
let logBuffer = [];
let logFlushTimer = null;
let tray = null;
let contextMenu = null;
let isQuitting = false;
let mousePassthrough = false;
let lastPinAt = 0;

function pinAlwaysOnTop(win, reason, force = false) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  if (!force && now - lastPinAt < PIN_THROTTLE_MS) return;
  lastPinAt = now;
  try {
    // Use highest commonly supported top-most tier on Windows.
    win.setAlwaysOnTop(true, "screen-saver");
  } catch (_error) {
    win.setAlwaysOnTop(true);
  }
  try {
    win.moveTop();
  } catch (_error) {
    // moveTop may fail on some platforms/window managers.
  }
  appendDebugLog("main", "pin-always-on-top", { reason, force });
}

function toSafeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ error: "non-serializable" });
  }
}

function flushLogBuffer() {
  logFlushTimer = null;
  if (!logBuffer.length || !debugLogPath) return;
  const chunk = logBuffer.join("");
  logBuffer = [];
  try {
    if (fs.existsSync(debugLogPath)) {
      const stat = fs.statSync(debugLogPath);
      if (stat.size > LOG_MAX_BYTES) {
        const bakPath = debugLogPath + ".bak";
        try {
          fs.renameSync(debugLogPath, bakPath);
        } catch (_e) {
          /* ignore */
        }
      }
    }
    fs.appendFileSync(debugLogPath, chunk, "utf8");
  } catch (_error) {
    // ignore IO failures
  }
}

function appendDebugLog(scope, message, data) {
  const time = new Date().toISOString();
  const suffix = data === undefined ? "" : ` ${toSafeJson(data)}`;
  const line = `${time} [${scope}] ${message}${suffix}`;
  console.log(line);
  if (!debugEnabled || !debugLogPath) return;
  logBuffer.push(`${line}\n`);
  if (logFlushTimer === null) logFlushTimer = setTimeout(flushLogBuffer, LOG_FLUSH_MS);
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

function attachWindowDebug(win) {
  if (!win || win.isDestroyed()) return;
  const log = (message, data) => appendDebugLog("window", message, data);

  log("created", { bounds: win.getBounds() });
  win.on("focus", () => log("focus"));
  win.on("blur", () => log("blur"));
  win.on("show", () => log("show"));
  win.on("hide", () => log("hide"));
  win.on("show", () => pinAlwaysOnTop(win, "show"));
  win.on("focus", () => pinAlwaysOnTop(win, "focus"));

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    appendDebugLog("console", "renderer-console", { level, message, line, sourceId });
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
  win.webContents.on("did-finish-load", () => {
    log("did-finish-load", { bounds: win.getBounds() });
    ready = true;
    if (pendingCommand) {
      win.webContents.send("host-command", { type: pendingCommand });
      log("flush-pending-command", { command: pendingCommand });
      pendingCommand = null;
    }
  });
}

function setMousePassthrough(next) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (next === mousePassthrough) return;
  mousePassthrough = next;
  if (next) {
    // forward: 点击穿透给下层应用，但 mousemove 仍转发到本窗口，
    // 渲染层据此判断是否悬停在主球上，从而决定是否恢复鼠标捕获。
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
  appendDebugLog("main", "set-mouse-passthrough", { passthrough: next });
}

function sendCommand(type) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!ready || mainWindow.webContents.isLoadingMainFrame()) {
    pendingCommand = type;
    appendDebugLog("main", "queue-command", { type });
    return;
  }
  mainWindow.webContents.send("host-command", { type });
  appendDebugLog("main", "send-command", { type });
}

function createMainWindow() {
  const bounds = getBottomRightBounds(WINDOW_SIZE);
  const devFlag = app.isPackaged ? "0" : "1";
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false, // 等 ready-to-show 再显示，避免内容未绘制完成时闪一下
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

  attachWindowDebug(win);
  win.loadFile(path.join(__dirname, "index.html"), { query: { dev: devFlag } });
  pinAlwaysOnTop(win, "create", true);

  // 兜底：个别环境（GPU 初始化异常等）ready-to-show 可能延迟甚至不触发，
  // 超时后强制显示，避免"进程在跑但球不出现"。
  let showFallbackTimer = null;
  win.once("ready-to-show", () => {
    if (showFallbackTimer) {
      clearTimeout(showFallbackTimer);
      showFallbackTimer = null;
    }
    if (isQuitting || win.isDestroyed()) return;
    win.show();
    setMousePassthrough(true);
    appendDebugLog("main", "ready-to-show", { bounds: win.getBounds() });
  });
  showFallbackTimer = setTimeout(() => {
    showFallbackTimer = null;
    if (isQuitting || win.isDestroyed() || win.isVisible()) return;
    win.show();
    setMousePassthrough(true);
    appendDebugLog("main", "show-fallback-timeout");
  }, 3000);

  // 拦截关闭：退出必须走托盘或右键菜单，避免误关后无法再操作
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    appendDebugLog("main", "close-intercepted");
  });

  return win;
}

function repositionWindow() {
  applyBottomRight(mainWindow, WINDOW_SIZE);
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: "展开文案球", click: () => sendCommand("open-orbit") },
    { label: "编辑文案", click: () => sendCommand("open-editor") },
    { type: "separator" },
    { label: "导入文案…", click: () => sendCommand("menu-import") },
    { label: "导出文案…", click: () => sendCommand("menu-export") },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        appendDebugLog("main", "context-menu-quit");
        app.quit();
      },
    },
  ]);
}

function showWindowForCommand() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function createTray() {
  if (tray) return;
  let image = null;
  try {
    // 走 fs 而非 nativeImage.createFromPath：后者是原生层读取，
    // 在 asar 虚拟路径下可能读不到，导致托盘图标空白。fs 已被 Electron patch 支持 asar。
    image = nativeImage.createFromBuffer(fs.readFileSync(TRAY_ICON_PATH));
    if (image.isEmpty()) image = null;
  } catch (_e) {
    image = null;
  }
  if (!image) image = nativeImage.createEmpty();
  try {
    tray = new Tray(image);
  } catch (_e) {
    tray = null;
    appendDebugLog("main", "tray-create-failed");
    return;
  }
  tray.setToolTip("悬浮文案球复制器");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "展开文案球",
        click: () => {
          showWindowForCommand();
          sendCommand("open-orbit");
        },
      },
      {
        label: "编辑文案",
        click: () => {
          showWindowForCommand();
          sendCommand("open-editor");
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          appendDebugLog("main", "tray-quit");
          app.quit();
        },
      },
    ]),
  );
  // Windows：左键点击也弹菜单；macOS 左键行为留给系统
  tray.on("click", () => {
    if (process.platform === "win32" && tray) tray.popUpContextMenu();
  });
  appendDebugLog("main", "tray-created");
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch (_e) {
    /* ignore */
  }
  tray = null;
}

ipcMain.on("set-passthrough", (_event, passthrough) => {
  setMousePassthrough(Boolean(passthrough));
});

ipcMain.on("show-context-menu", () => {
  if (!contextMenu) contextMenu = buildContextMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    contextMenu.popup({ window: mainWindow });
  } else {
    contextMenu.popup();
  }
});

ipcMain.on("renderer-debug-log", (_event, payload) => {
  if (!payload || typeof payload !== "object") return;
  const type = typeof payload.type === "string" ? payload.type : "event";
  appendDebugLog("renderer", type, payload.data);
});

ipcMain.handle("get-debug-log-path", () => debugLogPath);

ipcMain.handle("get-debug-log-tail", () => {
  if (logFlushTimer !== null) {
    clearTimeout(logFlushTimer);
    flushLogBuffer();
  }
  if (!debugLogPath) return "";
  try {
    const text = fs.readFileSync(debugLogPath, "utf8");
    const maxChars = 18000;
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch (_error) {
    return "";
  }
});

ipcMain.handle("write-clipboard", (_event, text) => {
  if (typeof text !== "string") return false;
  try {
    clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
});

ipcMain.handle("export-texts", async (_event, payload) => {
  const texts = payload && Array.isArray(payload.texts) ? payload.texts : null;
  if (!texts) return { ok: false, reason: "invalid-payload" };
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    title: "导出文案",
    defaultPath: `floating-copy-balls-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
  try {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      ringCounts: payload && Array.isArray(payload.ringCounts) ? payload.ringCounts : null,
      texts,
    };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf8");
    appendDebugLog("main", "export-texts-success", { path: result.filePath, count: texts.length });
    return { ok: true, path: result.filePath };
  } catch (error) {
    appendDebugLog("main", "export-texts-failed", { error: String(error) });
    return { ok: false, reason: "io-error", error: String(error) };
  }
});

ipcMain.handle("import-texts", async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "导入文案",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: "canceled" };
  const filePath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const texts = Array.isArray(parsed) ? parsed : parsed && parsed.texts;
    if (!Array.isArray(texts)) return { ok: false, reason: "invalid-format" };
    appendDebugLog("main", "import-texts-success", { path: filePath, count: texts.length });
    return { ok: true, texts, path: filePath };
  } catch (error) {
    appendDebugLog("main", "import-texts-failed", { error: String(error) });
    return { ok: false, reason: "io-error", error: String(error) };
  }
});

app.on("second-instance", () => {
  appendDebugLog("main", "second-instance");
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    pinAlwaysOnTop(mainWindow, "second-instance", true);
  }
});

app.whenReady().then(() => {
  debugLogPath = path.join(app.getPath("userData"), "debug.log");
  debugEnabled = !app.isPackaged || process.env.SPLIT_SPHERE_DEBUG === "1";
  appendDebugLog("main", "session-start", {
    pid: process.pid,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    debugEnabled,
    userDataPath: app.getPath("userData"),
    logPath: debugLogPath,
  });
  Menu.setApplicationMenu(null);
  mainWindow = createMainWindow();
  createTray();
  screen.on("display-metrics-changed", repositionWindow);
  screen.on("display-added", repositionWindow);
  screen.on("display-removed", repositionWindow);
  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      return;
    }
    mainWindow = createMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (logFlushTimer !== null) {
    clearTimeout(logFlushTimer);
    flushLogBuffer();
  }
  destroyTray();
});

app.on("window-all-closed", () => {
  appendDebugLog("main", "window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
