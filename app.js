const STORAGE_KEY = "floating-copy-balls-v2";
const RING_COUNTS = [3, 4, 5, 6];
const TOTAL_BALLS = RING_COUNTS.reduce((sum, count) => sum + count, 0);
const ORBIT_OPEN_STAGGER_MS = 18;   // 展开逐球延迟（内圈先出）
const ORBIT_CLOSE_STAGGER_MS = 12;  // 收回逐球延迟（外圈先收）
const ORBIT_CLOSE_DURATION_MS = 200; // 收回动效时长（对应 CSS 0.2s）
const RETURN_TO_PASSTHROUGH_DELAY_MS =
  ORBIT_CLOSE_DURATION_MS + ORBIT_CLOSE_STAGGER_MS * (TOTAL_BALLS - 1) + 50;
// 主球半径 43，额外留 9px 缓冲，避免指针贴边时 IPC 往返尚未生效导致首次点击丢失
const CENTER_BALL_HIT_RADIUS = 52;
const PASSTHROUGH_SYNC_THROTTLE_MS = 16;

// dev 标志由主进程通过 ?dev=1|0 下发：未打包或显式设置 SPLIT_SPHERE_DEBUG 时为 true
const IS_DEV = new URLSearchParams(window.location.search).get("dev") === "1";
window.__SPLIT_SPHERE_BOOTED__ = "app.js-loaded";
console.log("[renderer] app.js loaded");

const defaultTexts = [
  "早安", "收到", "安排中",
  "稍后回复", "马上处理", "已确认", "感谢支持",
  "进度正常", "请再确认", "已发给你", "今天完成", "继续推进",
  "稍等一下", "没问题", "了解了", "已收到", "进行中", "马上回复",
];

const launcher = document.getElementById("launcher");
const centerBall = document.getElementById("centerBall");
const orbit = document.getElementById("orbit");
const editorPanel = document.getElementById("editorPanel");
const editor = document.getElementById("editor");
const toast = document.getElementById("toast");
const fillDemoBtn = document.getElementById("fillDemoBtn");
const clearBtn = document.getElementById("clearBtn");
const closeEditorBtn = document.getElementById("closeEditorBtn");
let texts = loadTexts();
let toastTimer = null;
let passthroughSyncTimer = null;
let lastCopyText = "";
let lastCopyAt = 0;
let passthroughState = null;
let pointerInsideBall = false;
let passthroughSyncPending = false;

function getDesktopBridge() {
  return window.desktopBridge;
}

function debugLog(type, data) {
  // 生产环境静默，避免无效 IPC 开销
  if (!IS_DEV) return;
  const desktopBridge = getDesktopBridge();
  if (desktopBridge && typeof desktopBridge.logDebug === "function") {
    desktopBridge.logDebug(type, data);
    return;
  }
  console.log("[renderer-fallback]", type, data || {});
}

function describeTarget(target) {
  if (!target || !(target instanceof Element)) return String(target);
  const tag = target.tagName ? target.tagName.toLowerCase() : "node";
  const id = target.id ? `#${target.id}` : "";
  const classes = target.classList && target.classList.length > 0
    ? `.${Array.from(target.classList).slice(0, 3).join(".")}`
    : "";
  return `${tag}${id}${classes}`;
}

window.addEventListener("error", (event) => {
  debugLog("window-error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error && event.error.stack ? String(event.error.stack) : "",
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  debugLog("unhandledrejection", {
    reason: reason && reason.message ? reason.message : String(reason),
    stack: reason && reason.stack ? String(reason.stack) : "",
  });
});

function logCenterGeometry(reason) {
  const rect = centerBall.getBoundingClientRect();
  debugLog("center-geometry", {
    reason,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rect: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    },
    open: launcher.classList.contains("open"),
    editor: editorPanel.classList.contains("show"),
    passthrough: passthroughState,
  });
}

// ===== 鼠标穿透：单窗口常驻，平时点击穿透到底层应用 =====
// 主窗口恒为 640x640 且透明，若始终捕获鼠标会挡住桌面其他操作。
// 因此平时 setIgnoreMouseEvents(true, {forward:true})：
// 点击穿透给下层应用，但 mousemove 仍转发到本窗口，用于判断是否悬停在主球上。

function setPassthrough(next) {
  if (passthroughState === next) return;
  passthroughState = next;
  const bridge = getDesktopBridge();
  if (bridge && typeof bridge.setPassthrough === "function") {
    bridge.setPassthrough(next);
    debugLog("set-passthrough", { passthrough: next });
  }
}

function isSurfaceOpen() {
  return launcher.classList.contains("open") || editorPanel.classList.contains("show");
}

function syncPassthrough() {
  // 展开/编辑时必须捕获鼠标；否则仅当指针位于主球上方时捕获
  const shouldCapture = isSurfaceOpen() || pointerInsideBall;
  setPassthrough(!shouldCapture);
}

function schedulePassthroughSync(delayMs = 0) {
  if (passthroughSyncTimer) clearTimeout(passthroughSyncTimer);
  if (delayMs <= 0) {
    passthroughSyncTimer = null;
    syncPassthrough();
    return;
  }
  passthroughSyncTimer = setTimeout(() => {
    passthroughSyncTimer = null;
    syncPassthrough();
  }, delayMs);
}

function updatePointerInsideBall(clientX, clientY) {
  const rect = centerBall.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  return Math.sqrt(dx * dx + dy * dy) <= CENTER_BALL_HIT_RADIUS;
}

let lastPointerSyncAt = 0;
window.addEventListener(
  "mousemove",
  (event) => {
    const inside = updatePointerInsideBall(event.clientX, event.clientY);
    if (inside === pointerInsideBall) return;
    pointerInsideBall = inside;
    // 穿透状态下 forward 的 mousemove 很密集，用 rAF 合并，避免 IPC 风暴
    if (passthroughSyncPending) return;
    passthroughSyncPending = true;
    const now = Date.now();
    const wait = Math.max(0, PASSTHROUGH_SYNC_THROTTLE_MS - (now - lastPointerSyncAt));
    setTimeout(() => {
      passthroughSyncPending = false;
      lastPointerSyncAt = Date.now();
      syncPassthrough();
    }, wait);
  },
  { passive: true },
);

window.addEventListener("mouseleave", () => {
  if (!pointerInsideBall) return;
  pointerInsideBall = false;
  schedulePassthroughSync(0);
});

function loadTexts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(parsed)) return normalizeTexts(parsed);
  } catch (_err) {
    // Ignore malformed cache.
  }
  return normalizeTexts(defaultTexts);
}

function normalizeTexts(list) {
  const out = new Array(TOTAL_BALLS).fill("");
  for (let i = 0; i < TOTAL_BALLS; i += 1) {
    const value = list[i];
    out[i] = typeof value === "string" ? value : "";
  }
  return out;
}

function saveTexts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(texts));
}

// 防止每次击键都写 localStorage，延迟 300ms 合并写入
let saveTimer = null;
function saveTextsDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveTexts();
  }, 300);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1200);
}

function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toast.classList.remove("show");
}

function getPreviewText(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "空";
  return Array.from(cleaned).slice(0, 4).join("");
}

async function writeClipboardWithFallback(raw) {
  const bridge = getDesktopBridge();
  if (bridge && typeof bridge.writeClipboard === "function") {
    try {
      const ok = await bridge.writeClipboard(raw);
      if (ok) return { via: "host" };
    } catch (_err) {
      // fall through
    }
  }
  try {
    await navigator.clipboard.writeText(raw);
    return { via: "navigator" };
  } catch (_err) {
    // fall through
  }
  const input = document.createElement("textarea");
  input.value = raw;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand("copy");
  input.remove();
  return { via: "exec", ok };
}

async function copyText(text) {
  const raw = String(text || "");
  if (!raw.trim()) {
    debugLog("copy-empty");
    showToast("该球暂无文案");
    return;
  }

  const now = Date.now();
  if (raw === lastCopyText && now - lastCopyAt < 600) {
    debugLog("copy-dedup-skip", { length: raw.length });
    // 即使跳过实际写入，也要给反馈 + 收起轨道，避免表现为"点了没反应"
    showToast(`已复制: ${raw}`);
    if (launcher.classList.contains("open")) setOrbitOpen(false);
    return;
  }
  lastCopyText = raw;
  lastCopyAt = now;

  const result = await writeClipboardWithFallback(raw);
  debugLog("copy-success", { length: raw.length, via: result.via });
  showToast(`已复制: ${raw}`);
  if (launcher.classList.contains("open")) setOrbitOpen(false);
}

function getRingInfo(index) {
  let start = 0;
  for (let ring = 0; ring < RING_COUNTS.length; ring += 1) {
    const count = RING_COUNTS[ring];
    const end = start + count;
    if (index >= start && index < end) {
      return { ring, indexInRing: index - start, count };
    }
    start = end;
  }
  return { ring: 0, indexInRing: 0, count: 1 };
}

// 轨道半径以 640 为基准窗口，按实际窗口尺寸线性缩放。
// 原实现用 matchMedia("(max-width: 780px)") 判断，但窗口尺寸固定且不可缩放，移动端分支永不命中。
const ORBIT_BASE_SIZE = 640;
const ORBIT_BASE_RADII = [116, 206, 298, 390];

function getOrbitRadii() {
  const size = Math.min(window.innerWidth, window.innerHeight);
  if (!Number.isFinite(size) || size <= 0) return ORBIT_BASE_RADII.slice();
  const scale = Math.min(1, size / ORBIT_BASE_SIZE);
  return ORBIT_BASE_RADII.map((radius) => radius * scale);
}

function getBallOffset(index) {
  const ringInfo = getRingInfo(index);
  const radii = getOrbitRadii();
  const radius = radii[ringInfo.ring] || radii[0];
  const arcStart = 190;
  const arcEnd = 260;
  const step = ringInfo.count === 1 ? 0 : (arcEnd - arcStart) / (ringInfo.count - 1);
  const angleDeg = arcStart + step * ringInfo.indexInRing;
  const angle = angleDeg * (Math.PI / 180);
  return {
    ringInfo,
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius,
  };
}

function setBallOffset(ball, index) {
  const { dx, dy } = getBallOffset(index);
  ball.style.setProperty("--dx", `${dx}px`);
  ball.style.setProperty("--dy", `${dy}px`);
}

function createBall(index, text) {
  const { ringInfo } = getBallOffset(index);
  const ball = document.createElement("button");
  ball.type = "button";
  ball.className = `ball orbit-ball ring-${ringInfo.ring + 1}`;
  ball.dataset.index = String(index);
  ball.textContent = getPreviewText(text);
  ball.title = text || "空文案";
  // 内圈先出，外圈先收
  ball.style.setProperty("--open-delay", `${(index * ORBIT_OPEN_STAGGER_MS) / 1000}s`);
  ball.style.setProperty("--close-delay", `${((TOTAL_BALLS - 1 - index) * ORBIT_CLOSE_STAGGER_MS) / 1000}s`);
  setBallOffset(ball, index);
  ball.addEventListener("click", () => copyText(texts[index]));
  return ball;
}

// patch 模式，已存在的球只更新内容，避免销毁 DOM 导致动画状态丢失
function renderOrbit() {
  const existing = orbit.querySelectorAll(".orbit-ball");
  // 如果球的数量不对，完整重建
  if (existing.length !== texts.length) {
    orbit.innerHTML = "";
    texts.forEach((text, index) => orbit.appendChild(createBall(index, text)));
    return;
  }
  // 数量一致时，只 patch 文字和 title
  existing.forEach((ball, index) => {
    const text = texts[index];
    ball.textContent = getPreviewText(text);
    ball.title = text || "空文案";
  });
}

function updateOrbitLayout() {
  orbit.querySelectorAll(".orbit-ball").forEach((ball) => {
    const index = Number(ball.dataset.index);
    if (Number.isNaN(index)) return;
    setBallOffset(ball, index);
  });
}

function updateOrbitText(index, text) {
  const ball = orbit.querySelector(`.orbit-ball[data-index="${index}"]`);
  if (!ball) return;
  ball.textContent = getPreviewText(text);
  ball.title = text || "空文案";
}

const RING_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八"];

// 基于 RING_COUNTS 动态推导，新增/删减圈数时无需改动此处
function getLabel(index) {
  const { ring, indexInRing } = getRingInfo(index);
  const name = RING_LABELS[ring] || String(ring + 1);
  return `第${name}圈 ${indexInRing + 1}`;
}

function createEditorItem(index, text) {
  const wrap = document.createElement("div");
  wrap.className = "editor-item";

  const label = document.createElement("label");
  label.setAttribute("for", `txt-${index}`);
  label.textContent = getLabel(index);

  const input = document.createElement("input");
  input.id = `txt-${index}`;
  input.type = "text";
  input.value = text;
  input.placeholder = `文案 ${index + 1}`;
  input.addEventListener("input", () => {
    texts[index] = input.value;
    saveTextsDebounced(); // debounce 写入
    updateOrbitText(index, input.value);
  });

  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function renderEditor() {
  editor.innerHTML = "";
  texts.forEach((text, index) => {
    editor.appendChild(createEditorItem(index, text));
  });
}

function setOrbitOpen(open) {
  const wasOpen = launcher.classList.contains("open");
  debugLog("set-orbit-open", { open, from: wasOpen });
  if (open === wasOpen) return;
  launcher.classList.toggle("open", open);
  centerBall.setAttribute("aria-expanded", String(open));
  logCenterGeometry(open ? "set-orbit-open" : "set-orbit-close");
  if (open) {
    hideToast();
    if (passthroughSyncTimer) {
      clearTimeout(passthroughSyncTimer);
      passthroughSyncTimer = null;
    }
    syncPassthrough();
    return;
  }
  // 等收回动画播完再恢复穿透，避免动画中途失去鼠标捕获
  schedulePassthroughSync(RETURN_TO_PASSTHROUGH_DELAY_MS);
}

function setEditorVisible(show) {
  const wasVisible = editorPanel.classList.contains("show");
  debugLog("set-editor-visible", { show, from: wasVisible });
  if (show === wasVisible) return;
  editorPanel.classList.toggle("show", show);
  editorPanel.setAttribute("aria-hidden", String(!show));
  if (show) {
    if (passthroughSyncTimer) {
      clearTimeout(passthroughSyncTimer);
      passthroughSyncTimer = null;
    }
    syncPassthrough();
    return;
  }
  schedulePassthroughSync(0);
}

function resetOrbitToClosedState() {
  if (!launcher.classList.contains("open")) return;
  launcher.classList.add("no-transition");
  launcher.classList.remove("open");
  centerBall.setAttribute("aria-expanded", "false");
  // 强制同步布局，确保关闭态样式立即生效，随后的展开动画才能从头播放
  void orbit.offsetHeight;
  launcher.classList.remove("no-transition");
}

function toggleOrbit() {
  debugLog("toggle-orbit", { current: launcher.classList.contains("open") });
  const willOpen = !launcher.classList.contains("open");
  if (willOpen) {
    resetOrbitToClosedState();
    setEditorVisible(false);
  }
  setOrbitOpen(willOpen);
}

centerBall.addEventListener("click", (event) => {
  if (event.button !== 0) return;
  toggleOrbit();
});

centerBall.addEventListener("keydown", (event) => {
  debugLog("center-keydown", { key: event.key });
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleOrbit();
});

centerBall.addEventListener("contextmenu", (event) => {
  debugLog("center-contextmenu", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
  event.preventDefault();
  const bridge = getDesktopBridge();
  if (bridge && typeof bridge.showContextMenu === "function") {
    bridge.showContextMenu();
    return;
  }
  // 无主进程能力时（浏览器直接打开）退化为直接切换编辑面板
  setEditorVisible(!editorPanel.classList.contains("show"));
});

closeEditorBtn.addEventListener("click", () => setEditorVisible(false));

window.addEventListener("pointerdown", (event) => {
  debugLog("window-pointerdown", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
}, true);

window.addEventListener("contextmenu", (event) => {
  debugLog("window-contextmenu", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
}, true);

window.addEventListener("click", (event) => {
  debugLog("window-click", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
  const clickedLauncher = launcher.contains(event.target);
  const clickedEditor = editorPanel.contains(event.target);

  if (launcher.classList.contains("open") && !clickedLauncher) {
    setOrbitOpen(false);
  }

  if (editorPanel.classList.contains("show") && !clickedEditor && !clickedLauncher) {
    setEditorVisible(false);
  }
});

window.addEventListener("blur", () => {
  // 延迟 150ms：给刚触发的展开留出时间先取消收起
  setTimeout(() => {
    const isOrbitOpen = launcher.classList.contains("open");
    const isEditorOpen = editorPanel.classList.contains("show");
    if (!isOrbitOpen && !isEditorOpen) return;
    debugLog("window-blur-autoclose");
    if (isEditorOpen) {
      editorPanel.classList.remove("show");
      editorPanel.setAttribute("aria-hidden", "true");
    }
    if (isOrbitOpen) {
      launcher.classList.remove("open");
      centerBall.setAttribute("aria-expanded", "false");
    }
    schedulePassthroughSync(0);
  }, 150);
});

window.addEventListener("keydown", async (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l")) return;
  // 焦点在输入控件内时不劫持，避免打断正常的文本编辑快捷键
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge || typeof desktopBridge.getDebugLogTail !== "function") return;
  const tail = await desktopBridge.getDebugLogTail();
  if (!tail) {
    showToast("日志为空");
    return;
  }
  const copied = await writeClipboardWithFallback(tail);
  showToast(copied.via === "exec" && !copied.ok ? "日志复制失败" : "调试日志已复制");
});

fillDemoBtn.addEventListener("click", () => {
  texts = normalizeTexts(defaultTexts);
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已填充示例文案");
});

clearBtn.addEventListener("click", () => {
  const hasContent = texts.some((t) => String(t || "").trim().length > 0);
  if (hasContent) {
    const ok = window.confirm("确定清空全部 18 条文案？此操作不可撤销。");
    if (!ok) return;
  }
  texts = new Array(TOTAL_BALLS).fill("");
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已清空");
});

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");

async function handleExportTexts() {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.exportTexts !== "function") {
    showToast("当前环境不支持导出");
    return;
  }
  const result = await bridge.exportTexts({ texts, ringCounts: RING_COUNTS });
  if (result && result.ok) {
    showToast(`已导出 ${result.path}`);
  } else if (result && result.reason && result.reason !== "canceled") {
    showToast(`导出失败: ${result.reason}`);
  }
}

async function handleImportTexts() {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.importTexts !== "function") {
    showToast("当前环境不支持导入");
    return;
  }
  const result = await bridge.importTexts();
  if (!result || !result.ok) {
    if (result && result.reason && result.reason !== "canceled") {
      showToast(`导入失败: ${result.reason}`);
    }
    return;
  }
  const incoming = result.texts;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    showToast("文件无有效文案");
    return;
  }
  const confirmed = window.confirm(
    `将覆盖当前 ${TOTAL_BALLS} 条文案（导入 ${incoming.length} 条），是否继续？`,
  );
  if (!confirmed) return;
  texts = normalizeTexts(incoming);
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast(`已导入 ${incoming.length} 条`);
}

if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    handleExportTexts();
  });
}

if (importBtn) {
  importBtn.addEventListener("click", () => {
    handleImportTexts();
  });
}

window.addEventListener("resize", () => {
  updateOrbitLayout();
  logCenterGeometry("window-resize");
});

renderEditor();
renderOrbit();
logCenterGeometry("startup");
debugLog("renderer-startup", {
  viewport: { width: window.innerWidth, height: window.innerHeight },
  userAgent: navigator.userAgent,
});

const bridgeForLogPath = getDesktopBridge();
if (bridgeForLogPath && typeof bridgeForLogPath.getDebugLogPath === "function") {
  bridgeForLogPath.getDebugLogPath().then((logPath) => {
    debugLog("debug-log-path", { logPath });
  });
}
if (bridgeForLogPath && typeof bridgeForLogPath.onHostCommand === "function") {
  bridgeForLogPath.onHostCommand((payload) => {
    if (!payload || typeof payload !== "object") return;
    const type = payload.type;
    debugLog("host-command", payload);
    if (type === "open-orbit") {
      setEditorVisible(false);
      resetOrbitToClosedState();
      setOrbitOpen(true);
      return;
    }
    if (type === "open-editor") {
      setOrbitOpen(false);
      setEditorVisible(true);
      return;
    }
    if (type === "menu-export") {
      handleExportTexts();
      return;
    }
    if (type === "menu-import") {
      handleImportTexts();
    }
  });
}

// 启动即进入穿透态：主球始终可见，但不拦截桌面其他操作
syncPassthrough();
