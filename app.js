const STORAGE_KEY = "floating-copy-balls-v2";
const RING_COUNTS = [3, 4, 5];
const TOTAL_BALLS = RING_COUNTS.reduce((sum, count) => sum + count, 0);
const ORBIT_OPEN_STAGGER_MS = 25;
const ORBIT_CLOSE_STAGGER_MS = 20;
const ORBIT_TRANSITION_MS = 450;
const RETURN_TO_ANCHOR_DELAY_MS = ORBIT_TRANSITION_MS + ORBIT_CLOSE_STAGGER_MS * (TOTAL_BALLS - 1) + 120;
const MODE = new URLSearchParams(window.location.search).get("mode") || "overlay";
const IS_ANCHOR_MODE = MODE === "anchor";
const IS_OVERLAY_MODE = !IS_ANCHOR_MODE;
window.__SPLIT_SPHERE_BOOTED__ = "app.js-loaded";
console.log("[renderer] app.js loaded");

const defaultTexts = [
  "早安", "收到", "安排中",
  "稍后回复", "马上处理", "已确认", "感谢支持",
  "进度正常", "请再确认", "已发给你", "今天完成", "继续推进",
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
let returnToAnchorTimer = null;
let lastCopyText = "";
let lastCopyAt = 0;
document.body.classList.add(IS_ANCHOR_MODE ? "mode-anchor" : "mode-overlay");

function getDesktopBridge() {
  return window.desktopBridge;
}

function debugLog(type, data) {
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
  });
}

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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1200);
}

function getPreviewText(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "空";
  return Array.from(cleaned).slice(0, 4).join("");
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
    return;
  }
  lastCopyText = raw;
  lastCopyAt = now;

  try {
    await navigator.clipboard.writeText(raw);
    debugLog("copy-success", { length: raw.length });
    showToast(`已复制: ${raw}`);
    if (launcher.classList.contains("open")) setOrbitOpen(false);
  } catch (_err) {
    debugLog("copy-fallback", { length: raw.length });
    const input = document.createElement("textarea");
    input.value = raw;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast(`已复制: ${raw}`);
    if (launcher.classList.contains("open")) setOrbitOpen(false);
  }
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

function getOrbitRadii() {
  const isMobile = window.matchMedia("(max-width: 780px)").matches;
  return isMobile ? [86, 152, 220] : [116, 206, 298];
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

function getCloseDelayMs(ring, indexInRing, count) {
  let base = 0;
  for (let r = RING_COUNTS.length - 1; r > ring; r -= 1) {
    base += RING_COUNTS[r] * ORBIT_CLOSE_STAGGER_MS;
  }
  return base + (count - 1 - indexInRing) * ORBIT_CLOSE_STAGGER_MS;
}

function createBall(index, text) {
  const { ringInfo } = getBallOffset(index);
  const ball = document.createElement("button");
  ball.type = "button";
  ball.className = `ball orbit-ball ring-${ringInfo.ring + 1}`;
  ball.dataset.index = String(index);
  ball.textContent = getPreviewText(text);
  ball.title = text || "空文案";
  ball.style.setProperty("--delay", `${(index * ORBIT_OPEN_STAGGER_MS) / 1000}s`);
  ball.style.setProperty("--close-delay", `${getCloseDelayMs(ringInfo.ring, ringInfo.indexInRing, ringInfo.count) / 1000}s`);
  setBallOffset(ball, index);

  ball.addEventListener("click", () => copyText(text));
  return ball;
}

function renderOrbit() {
  orbit.innerHTML = "";
  texts.forEach((text, index) => {
    orbit.appendChild(createBall(index, text));
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

function getLabel(index) {
  if (index < RING_COUNTS[0]) return `第一圈 ${index + 1}`;
  if (index < RING_COUNTS[0] + RING_COUNTS[1]) return `第二圈 ${index - RING_COUNTS[0] + 1}`;
  return `第三圈 ${index - RING_COUNTS[0] - RING_COUNTS[1] + 1}`;
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
    saveTexts();
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

function requestOpenOverlay(mode) {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge || typeof desktopBridge.openOverlay !== "function") return;
  if (mode !== "orbit" && mode !== "editor") return;
  debugLog("open-overlay-request", { mode });
  desktopBridge.openOverlay(mode);
}

function requestCloseOverlay() {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge || typeof desktopBridge.closeOverlay !== "function") return;
  debugLog("close-overlay-request");
  desktopBridge.closeOverlay();
}

function clearReturnToAnchorTimer() {
  if (!returnToAnchorTimer) return;
  clearTimeout(returnToAnchorTimer);
  returnToAnchorTimer = null;
}

function maybeReturnToAnchor(delayMs = 0) {
  if (!IS_OVERLAY_MODE) return;
  clearReturnToAnchorTimer();
  returnToAnchorTimer = setTimeout(() => {
    returnToAnchorTimer = null;
    if (launcher.classList.contains("open") || editorPanel.classList.contains("show")) return;
    requestCloseOverlay();
  }, delayMs);
}

function setOrbitOpen(open) {
  const wasOpen = launcher.classList.contains("open");
  debugLog("set-orbit-open", { open, from: wasOpen });
  if (open === wasOpen) return;
  launcher.classList.toggle("open", open);
  centerBall.setAttribute("aria-expanded", String(open));
  logCenterGeometry(open ? "set-orbit-open" : "set-orbit-close");
  if (open) {
    clearReturnToAnchorTimer();
    return;
  }
  if (!editorPanel.classList.contains("show")) {
    maybeReturnToAnchor(RETURN_TO_ANCHOR_DELAY_MS);
  }
}

function setEditorVisible(show) {
  const wasVisible = editorPanel.classList.contains("show");
  debugLog("set-editor-visible", { show, from: wasVisible });
  if (show === wasVisible) return;
  editorPanel.classList.toggle("show", show);
  editorPanel.setAttribute("aria-hidden", String(!show));
  if (show || launcher.classList.contains("open")) {
    clearReturnToAnchorTimer();
    return;
  }
  maybeReturnToAnchor(0);
}

function toggleOrbit() {
  debugLog("toggle-orbit", { current: launcher.classList.contains("open") });
  setOrbitOpen(!launcher.classList.contains("open"));
}

centerBall.addEventListener("click", (event) => {
  debugLog("center-click", {
    button: event.button,
    detail: event.detail,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
  if (event.button !== 0) return;
  if (IS_ANCHOR_MODE) {
    requestOpenOverlay("orbit");
    return;
  }
  toggleOrbit();
});

centerBall.addEventListener("keydown", (event) => {
  debugLog("center-keydown", { key: event.key });
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (IS_ANCHOR_MODE) {
    requestOpenOverlay("orbit");
    return;
  }
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
  if (IS_ANCHOR_MODE) {
    requestOpenOverlay("editor");
    return;
  }
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
  if (!IS_OVERLAY_MODE) return;
  const clickedLauncher = launcher.contains(event.target);
  const clickedEditor = editorPanel.contains(event.target);

  if (launcher.classList.contains("open") && !clickedLauncher) {
    setOrbitOpen(false);
  }

  if (editorPanel.classList.contains("show") && !clickedEditor && !clickedLauncher) {
    setEditorVisible(false);
  }
});

window.addEventListener("keydown", async (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l")) return;
  event.preventDefault();
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge || typeof desktopBridge.getDebugLogTail !== "function") return;
  const tail = await desktopBridge.getDebugLogTail();
  if (!tail) {
    showToast("日志为空");
    return;
  }
  try {
    await navigator.clipboard.writeText(tail);
    showToast("调试日志已复制");
  } catch (_err) {
    showToast("日志复制失败");
  }
});

fillDemoBtn.addEventListener("click", () => {
  if (!IS_OVERLAY_MODE) return;
  texts = normalizeTexts(defaultTexts);
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已填充示例文案");
});

clearBtn.addEventListener("click", () => {
  if (!IS_OVERLAY_MODE) return;
  texts = new Array(TOTAL_BALLS).fill("");
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已清空");
});

window.addEventListener("resize", () => {
  if (!IS_OVERLAY_MODE) return;
  updateOrbitLayout();
  logCenterGeometry("window-resize");
});

if (IS_OVERLAY_MODE) {
  renderEditor();
  renderOrbit();
} else {
  orbit.innerHTML = "";
  editorPanel.classList.remove("show");
  editorPanel.setAttribute("aria-hidden", "true");
}
logCenterGeometry("startup");
debugLog("renderer-startup", {
  mode: MODE,
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
    if (!IS_OVERLAY_MODE || !payload || typeof payload !== "object") return;
    const type = payload.type;
    debugLog("host-command", payload);
    if (type === "open-orbit") {
      setEditorVisible(false);
      setOrbitOpen(true);
      return;
    }
    if (type === "open-editor") {
      setOrbitOpen(false);
      setEditorVisible(true);
    }
  });
}
