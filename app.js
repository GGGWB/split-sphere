const STORAGE_KEY = "floating-copy-balls-v2";
const RING_COUNTS = [3, 4, 5];
const TOTAL_BALLS = RING_COUNTS.reduce((sum, count) => sum + count, 0);

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
const desktopBridge = window.desktopBridge;
let texts = loadTexts();
let toastTimer = null;

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
    showToast("该球暂无文案");
    return false;
  }

  try {
    await navigator.clipboard.writeText(raw);
    showToast(`已复制: ${raw}`);
    return true;
  } catch (_err) {
    const input = document.createElement("textarea");
    input.value = raw;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast(`已复制: ${raw}`);
    return true;
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

  ball.addEventListener("click", async () => {
    const copied = await copyText(text);
    if (copied) setOrbitOpen(false);
  });
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

function syncWindowPreset() {
  if (!desktopBridge || typeof desktopBridge.setWindowPreset !== "function") return;
  const orbitOpen = launcher.classList.contains("open");
  const editorOpen = editorPanel.classList.contains("show");
  desktopBridge.setWindowPreset(orbitOpen || editorOpen ? "expanded" : "compact");
}

function setOrbitOpen(open) {
  launcher.classList.toggle("open", open);
  centerBall.setAttribute("aria-expanded", String(open));
  syncWindowPreset();
}

function setEditorVisible(show) {
  editorPanel.classList.toggle("show", show);
  editorPanel.setAttribute("aria-hidden", String(!show));
  syncWindowPreset();
}

centerBall.addEventListener("click", () => {
  setOrbitOpen(!launcher.classList.contains("open"));
});

centerBall.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  setEditorVisible(!editorPanel.classList.contains("show"));
});

closeEditorBtn.addEventListener("click", () => setEditorVisible(false));

window.addEventListener("click", (event) => {
  if (launcher.classList.contains("open") && !launcher.contains(event.target)) {
    setOrbitOpen(false);
  }

  if (editorPanel.classList.contains("show")) {
    const clickedEditor = editorPanel.contains(event.target);
    const clickedCenter = centerBall.contains(event.target);
    if (!clickedEditor && !clickedCenter) {
      setEditorVisible(false);
    }
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

window.addEventListener("resize", renderOrbit);

renderEditor();
renderOrbit();
syncWindowPreset();
