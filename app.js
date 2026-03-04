const STORAGE_KEY = "floating-copy-balls-v2";
const RING_COUNTS = [3, 4, 5];
const TOTAL_BALLS = RING_COUNTS.reduce((sum, count) => sum + count, 0);
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

function createBall(index, text) {
  const ringInfo = getRingInfo(index);
  const ball = document.createElement("button");
  ball.type = "button";
  ball.className = `ball orbit-ball ring-${ringInfo.ring + 1}`;
  ball.textContent = getPreviewText(text);
  ball.title = text || "空文案";
  ball.style.setProperty("--delay", `${index * 0.025}s`);

  const isMobile = window.matchMedia("(max-width: 780px)").matches;
  // Keep all balls in the upper-left sector and enlarge ring gaps to avoid overlap.
  const radii = isMobile ? [86, 152, 220] : [116, 206, 298];
  const radius = radii[ringInfo.ring] || radii[0];

  const arcStart = 190;
  const arcEnd = 260;
  const step = ringInfo.count === 1 ? 0 : (arcEnd - arcStart) / (ringInfo.count - 1);
  const angleDeg = arcStart + step * ringInfo.indexInRing;
  const angle = angleDeg * (Math.PI / 180);

  const dx = `${Math.cos(angle) * radius}px`;
  const dy = `${Math.sin(angle) * radius}px`;
  ball.style.setProperty("--dx", dx);
  ball.style.setProperty("--dy", dy);

  ball.addEventListener("click", () => copyText(text));
  return ball;
}

function renderOrbit() {
  orbit.innerHTML = "";
  texts.forEach((text, index) => {
    orbit.appendChild(createBall(index, text));
  });
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
    renderOrbit();
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

function syncInteractionLock() {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge || typeof desktopBridge.setWindowPreset !== "function") return;
  const isOrbitOpen = launcher.classList.contains("open");
  const isEditorOpen = editorPanel.classList.contains("show");
  const preset = isOrbitOpen || isEditorOpen ? "expanded" : "compact";
  debugLog("set-window-preset", { preset, isOrbitOpen, isEditorOpen });
  desktopBridge.setWindowPreset(preset);
}

function setOrbitOpen(open) {
  debugLog("set-orbit-open", { open, from: launcher.classList.contains("open") });
  launcher.classList.toggle("open", open);
  centerBall.setAttribute("aria-expanded", String(open));
  syncInteractionLock();
  logCenterGeometry("set-orbit-open");
}

function setEditorVisible(show) {
  debugLog("set-editor-visible", { show, from: editorPanel.classList.contains("show") });
  editorPanel.classList.toggle("show", show);
  editorPanel.setAttribute("aria-hidden", String(!show));
  syncInteractionLock();
}

function toggleOrbit() {
  debugLog("toggle-orbit", { current: launcher.classList.contains("open") });
  setOrbitOpen(!launcher.classList.contains("open"));
}

centerBall.addEventListener("pointerdown", (event) => {
  debugLog("center-pointerdown", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    target: describeTarget(event.target),
  });
  if (event.button !== 0) return;
  event.preventDefault();
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
  texts = normalizeTexts(defaultTexts);
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已填充示例文案");
});

clearBtn.addEventListener("click", () => {
  texts = new Array(TOTAL_BALLS).fill("");
  saveTexts();
  renderEditor();
  renderOrbit();
  showToast("已清空");
});

window.addEventListener("resize", () => {
  renderOrbit();
  logCenterGeometry("window-resize");
});

renderEditor();
renderOrbit();
syncInteractionLock();
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
