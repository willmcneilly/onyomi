const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿＀-￯]/;
const TOOLBAR_OFFSET = 4;
const BUTTON_SIZE = 28;
const TOOLBAR_WIDTH = BUTTON_SIZE * 2 + 4;
const CONFIRM_TIMEOUT_MS = 3000;
const DEFAULT_CHAR_LIMIT = 500;
const TOAST_DURATION_MS = 4000;

const PLAY_ICON_HTML = '<span class="onyomi-icon"></span>';
const WARN_ICON_HTML = '<span class="onyomi-warn-icon">⚠</span>';

const { toolbar, playBtn, randomBtn, warning } = createToolbar();
let currentText = "";
let isLoading = false;
let charLimit = DEFAULT_CHAR_LIMIT;
let hasKey = false;
let confirmPending = false;
let confirmTimer = null;

let toastEl = null;
let toastTimer = null;

chrome.storage.local.get(
  { selectionCharLimit: DEFAULT_CHAR_LIMIT, ttsCredentials: { key: "" } },
  ({ selectionCharLimit, ttsCredentials }) => {
    charLimit = selectionCharLimit;
    hasKey = !!ttsCredentials?.key;
    applyNoKeyState();
  }
);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.selectionCharLimit) {
    charLimit = changes.selectionCharLimit.newValue ?? DEFAULT_CHAR_LIMIT;
  }
  if (changes.ttsCredentials) {
    hasKey = !!changes.ttsCredentials.newValue?.key;
    applyNoKeyState();
  }
});

function createToolbar() {
  const wrap = document.createElement("div");
  wrap.className = "onyomi-toolbar";
  wrap.style.display = "none";

  const warn = document.createElement("div");
  warn.className = "onyomi-warning";
  wrap.appendChild(warn);

  const play = document.createElement("button");
  play.className = "onyomi-btn onyomi-play";
  play.type = "button";
  play.setAttribute("aria-label", "Speak selection");
  play.innerHTML = PLAY_ICON_HTML;
  play.addEventListener("mousedown", (e) => e.preventDefault());
  play.addEventListener("click", () => playCurrent({ random: false }));

  const random = document.createElement("button");
  random.className = "onyomi-btn onyomi-random";
  random.type = "button";
  random.setAttribute("aria-label", "Speak in a random voice");
  random.textContent = "🔀";
  random.addEventListener("mousedown", (e) => e.preventDefault());
  random.addEventListener("click", () => playCurrent({ random: true }));

  wrap.appendChild(play);
  wrap.appendChild(random);
  document.documentElement.appendChild(wrap);
  return { toolbar: wrap, playBtn: play, randomBtn: random, warning: warn };
}

function applyNoKeyState() {
  toolbar.classList.toggle("onyomi-no-key", !hasKey);
  if (hasKey) {
    playBtn.innerHTML = PLAY_ICON_HTML;
    playBtn.setAttribute("aria-label", "Speak selection");
    playBtn.title = "";
  } else {
    playBtn.innerHTML = WARN_ICON_HTML;
    playBtn.setAttribute("aria-label", "Set Azure key in extension options");
    playBtn.title = "Set Azure key in extension options";
  }
}

function showToolbar(rect) {
  const top = Math.max(rect.top - BUTTON_SIZE - TOOLBAR_OFFSET, TOOLBAR_OFFSET);
  const left = Math.max(
    Math.min(rect.right - TOOLBAR_WIDTH, window.innerWidth - TOOLBAR_WIDTH - TOOLBAR_OFFSET),
    TOOLBAR_OFFSET
  );
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.style.display = "flex";
}

function hideToolbar() {
  if (isLoading) return;
  toolbar.style.display = "none";
  currentText = "";
  clearConfirmation();
}

function armConfirmation(text) {
  confirmPending = true;
  warning.textContent = `Play ${text.length.toLocaleString()} chars?`;
  toolbar.classList.add("onyomi-confirm");
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(clearConfirmation, CONFIRM_TIMEOUT_MS);
}

function clearConfirmation() {
  confirmPending = false;
  clearTimeout(confirmTimer);
  confirmTimer = null;
  toolbar.classList.remove("onyomi-confirm");
}

function setLoadingVisual(loading) {
  playBtn.classList.toggle("onyomi-loading", loading);
  playBtn.disabled = loading;
  randomBtn.disabled = loading;
}

function getSelectionInfo() {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || !CJK_RE.test(text) || sel.rangeCount === 0) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { text, rect };
}

function onSelectionChange() {
  const info = getSelectionInfo();
  if (!info) {
    hideToolbar();
    return;
  }
  if (info.text !== currentText) clearConfirmation();
  currentText = info.text;
  showToolbar(info.rect);
}

function openOptions() {
  chrome.runtime.sendMessage({ type: "open-options" });
}

async function playCurrent({ random } = {}) {
  if (!currentText || isLoading) return;

  if (!hasKey) {
    showToast({
      text: "No Azure key configured.",
      error: true,
      action: { label: "Open options", onClick: openOptions },
    });
    return;
  }

  if (currentText.length > charLimit && !confirmPending) {
    armConfirmation(currentText);
    return;
  }
  clearConfirmation();

  isLoading = true;
  const spinnerTimer = setTimeout(() => setLoadingVisual(true), 80);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "speak",
      text: currentText,
      random: !!random,
    });
    if (response?.ok) {
      playAudio(response.audio);
    } else {
      handleSpeakError(response);
    }
  } catch (e) {
    console.error("Onyomi: messaging failed", e);
    showToast({ text: "Onyomi couldn't reach its background process. Try reloading the page.", error: true });
  } finally {
    clearTimeout(spinnerTimer);
    setLoadingVisual(false);
    isLoading = false;
    if (!getSelectionInfo()) hideToolbar();
  }
}

function handleSpeakError(response) {
  const { kind, message } = response || {};
  console.error("Onyomi:", kind, message);
  switch (kind) {
    case "auth":
      showToast({
        text: "Azure rejected the key — open options to update.",
        error: true,
        action: { label: "Open options", onClick: openOptions },
      });
      return;
    case "rate-limited":
      showToast({
        text: "Azure refused — rate limit or quota reached. Check the Azure portal.",
        error: true,
      });
      return;
    case "bad-request":
      showToast({
        text: "Azure rejected the request — likely an invalid voice or text.",
        error: true,
      });
      return;
    case "server":
      showToast({ text: "Azure TTS is having problems — try again in a moment.", error: true });
      return;
    case "network":
      showToast({
        text: "Couldn't reach Azure — check your connection or region in options.",
        error: true,
        action: { label: "Open options", onClick: openOptions },
      });
      return;
    default:
      showToast({ text: `Onyomi error: ${message || kind || "unknown"}`, error: true });
  }
}

function playAudio(audio) {
  const bytes = new Uint8Array(audio);
  if (bytes.byteLength === 0) {
    showToast({ text: "Couldn't play returned audio (empty response).", error: true });
    return;
  }
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const el = new Audio(url);
  el.onended = () => URL.revokeObjectURL(url);
  el.onerror = () => {
    showToast({ text: "Couldn't play returned audio.", error: true });
    URL.revokeObjectURL(url);
  };
  el.play().catch(() => {
    showToast({ text: "Couldn't play returned audio.", error: true });
    URL.revokeObjectURL(url);
  });
}

function showToast({ text, error, action }) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "onyomi-toast";
    toastEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("onyomi-toast-action")) return;
      hideToast();
    });
    document.documentElement.appendChild(toastEl);
  }
  toastEl.classList.toggle("onyomi-toast-error", !!error);
  toastEl.replaceChildren(document.createTextNode(text));
  if (action) {
    const btn = document.createElement("button");
    btn.className = "onyomi-toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.onClick();
      hideToast();
    });
    toastEl.appendChild(btn);
  }
  requestAnimationFrame(() => toastEl.classList.add("onyomi-toast-show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_DURATION_MS);
}

function hideToast() {
  if (toastEl) toastEl.classList.remove("onyomi-toast-show");
  clearTimeout(toastTimer);
  toastTimer = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "speak-selection") return;
  const info = getSelectionInfo();
  if (info) {
    currentText = info.text;
    showToolbar(info.rect);
  }
  if (currentText) playCurrent();
});

document.addEventListener("selectionchange", onSelectionChange);
