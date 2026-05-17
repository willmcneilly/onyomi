const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿＀-￯]/;
const PILL_OFFSET = 4;
const PILL_RIGHT_PAD = 8;
const CONFIRM_TIMEOUT_MS = 3000;
const DEFAULT_CHAR_LIMIT = 500;
const TOAST_DURATION_MS = 4000;

const SVG_PLAY = '<svg class="onyomi-icon-play" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1l-7.6-4.8a.6.6 0 0 0-.92.5z"/></svg>';
const SVG_SPINNER = '<svg class="onyomi-icon-spinner" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-opacity="0.18" stroke-width="1.6" fill="none"/><path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
const SVG_SHUFFLE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14"><path d="M3 4h2.4L11 12h2"/><path d="M3 12h2.4L11 4h2"/><path d="m12 2 2 2-2 2"/><path d="m12 10 2 2-2 2"/></svg>';
const SVG_WARN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="13" height="13"><path d="M8 2.5 14 13H2L8 2.5Z"/><path d="M8 7v3"/><circle cx="8" cy="11.7" r=".6" fill="currentColor" stroke="none"/></svg>';
const SVG_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

const { pill, playBtn, shuffleBtn, confirmText, confirmBtn, noKeyBtn, voiceLabel } = createPill();
let currentText = "";
let isLoading = false;
let isPlaying = false;
let currentAudio = null;
let charLimit = DEFAULT_CHAR_LIMIT;
let hasKey = false;
let voiceMap = {};
let confirmPending = false;
let confirmTimer = null;

let toastEl = null;
let toastTimer = null;

chrome.storage.local.get(
  {
    selectionCharLimit: DEFAULT_CHAR_LIMIT,
    ttsCredentials: { key: "" },
    voices: [],
  },
  ({ selectionCharLimit, ttsCredentials, voices }) => {
    charLimit = selectionCharLimit;
    hasKey = !!ttsCredentials?.key;
    voiceMap = Object.fromEntries((voices || []).map((v) => [v.id, v]));
    applyState();
  }
);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.selectionCharLimit) {
    charLimit = changes.selectionCharLimit.newValue ?? DEFAULT_CHAR_LIMIT;
  }
  if (changes.ttsCredentials) {
    hasKey = !!changes.ttsCredentials.newValue?.key;
    applyState();
  }
  if (changes.voices) {
    voiceMap = Object.fromEntries((changes.voices.newValue || []).map((v) => [v.id, v]));
  }
});

function createPill() {
  const el = document.createElement("div");
  el.className = "onyomi-pill";
  el.style.display = "none";
  el.innerHTML = `
    <button class="onyomi-play" type="button" aria-label="Speak selection">
      ${SVG_PLAY}${SVG_SPINNER}
    </button>
    <button class="onyomi-shuffle" type="button" aria-label="Speak in a random voice">
      ${SVG_SHUFFLE}
    </button>
    <div class="onyomi-now-playing">
      <div class="onyomi-waveform"><span></span><span></span><span></span><span></span><span></span></div>
      <span class="onyomi-voice-label"></span>
    </div>
    <div class="onyomi-confirm-content">
      <span class="onyomi-confirm-text"></span>
      <button class="onyomi-confirm-btn" type="button">Play</button>
    </div>
    <button class="onyomi-no-key-content" type="button" aria-label="Set your Azure key in options">
      ${SVG_WARN}<span>Set your Azure key in options</span>
    </button>
  `;
  const stopFocus = (e) => e.preventDefault();
  el.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", stopFocus));

  const playEl = el.querySelector(".onyomi-play");
  const shuffleEl = el.querySelector(".onyomi-shuffle");
  const confirmContentText = el.querySelector(".onyomi-confirm-text");
  const confirmContentBtn = el.querySelector(".onyomi-confirm-btn");
  const noKeyEl = el.querySelector(".onyomi-no-key-content");
  const voiceLabelEl = el.querySelector(".onyomi-voice-label");

  playEl.addEventListener("click", () => playCurrent({ random: false }));
  shuffleEl.addEventListener("click", () => playCurrent({ random: true }));
  confirmContentBtn.addEventListener("click", () => playCurrent({ random: false }));
  noKeyEl.addEventListener("click", openOptions);

  document.documentElement.appendChild(el);
  return {
    pill: el,
    playBtn: playEl,
    shuffleBtn: shuffleEl,
    confirmText: confirmContentText,
    confirmBtn: confirmContentBtn,
    noKeyBtn: noKeyEl,
    voiceLabel: voiceLabelEl,
  };
}

function pillWidth() {
  return pill.offsetWidth || 70;
}

function showPill(rect) {
  const w = pillWidth();
  const h = 38;
  const top = Math.max(rect.top - h - PILL_OFFSET, PILL_OFFSET);
  const left = Math.max(
    Math.min(rect.right - w, window.innerWidth - w - PILL_RIGHT_PAD),
    PILL_OFFSET
  );
  pill.style.top = `${top}px`;
  pill.style.left = `${left}px`;
  pill.style.display = "inline-flex";
}

function hidePill() {
  if (isLoading || isPlaying) return;
  pill.style.display = "none";
  currentText = "";
  clearConfirmation();
}

function applyState() {
  // State precedence: no-key > confirm > loading/playing > idle
  pill.classList.toggle("onyomi-no-key", !hasKey);
  pill.classList.toggle("onyomi-confirm", confirmPending && hasKey);
  pill.classList.toggle("onyomi-loading", isLoading && hasKey && !confirmPending);
  pill.classList.toggle("onyomi-playing", isPlaying && hasKey && !confirmPending);
  playBtn.disabled = isLoading;
  shuffleBtn.disabled = isLoading;
}

function armConfirmation(text) {
  confirmPending = true;
  confirmText.innerHTML = `Play <b>${text.length.toLocaleString()}</b> characters?`;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(clearConfirmation, CONFIRM_TIMEOUT_MS);
  applyState();
}

function clearConfirmation() {
  confirmPending = false;
  clearTimeout(confirmTimer);
  confirmTimer = null;
  applyState();
}

function lookupVoice(voiceId) {
  if (voiceMap[voiceId]) return voiceMap[voiceId];
  const m = voiceId.match(/-([A-Za-z]+)Neural$/);
  return { id: voiceId, displayName: m ? m[1] : voiceId, localName: "" };
}

function setVoiceLabel(voiceId) {
  const meta = lookupVoice(voiceId);
  if (meta.localName) {
    voiceLabel.innerHTML = `${escapeText(meta.displayName)} <span class="jp">${escapeText(meta.localName)}</span>`;
  } else {
    voiceLabel.textContent = meta.displayName;
  }
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    hidePill();
    return;
  }
  if (info.text !== currentText) clearConfirmation();
  currentText = info.text;
  showPill(info.rect);
}

function openOptions() {
  chrome.runtime.sendMessage({ type: "open-options" });
}

function stopCurrentAudio() {
  if (!currentAudio) return;
  const { el, url } = currentAudio;
  el.onended = null;
  el.onerror = null;
  try {
    el.pause();
  } catch (_) {}
  URL.revokeObjectURL(url);
  currentAudio = null;
}

async function playCurrent({ random } = {}) {
  if (!currentText) return;

  if (!hasKey) {
    showToast({
      title: "No Azure key configured",
      text: "Set the key in options to start playing.",
      action: { label: "Open options →", onClick: openOptions },
    });
    return;
  }

  if (isLoading) return;

  if (currentText.length > charLimit && !confirmPending) {
    armConfirmation(currentText);
    return;
  }
  clearConfirmation();

  stopCurrentAudio();
  isPlaying = false;

  isLoading = true;
  const spinnerTimer = setTimeout(applyState, 80);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "speak",
      text: currentText,
      random: !!random,
    });
    if (response?.ok) {
      playAudio(response.audio, response.voice);
    } else {
      handleSpeakError(response);
    }
  } catch (e) {
    console.error("Onyomi: messaging failed", e);
    showToast({
      title: "Onyomi couldn't reach its background process",
      text: "Try reloading the page.",
    });
  } finally {
    clearTimeout(spinnerTimer);
    isLoading = false;
    applyState();
    if (!isPlaying && !getSelectionInfo()) hidePill();
  }
}

function handleSpeakError(response) {
  const { kind, message } = response || {};
  console.error("Onyomi:", kind, message);
  switch (kind) {
    case "auth":
      showToast({
        title: "Azure rejected the key",
        text: "Open options to update — or check the region matches your resource.",
        action: { label: "Open options →", onClick: openOptions },
      });
      return;
    case "rate-limited":
      showToast({
        title: "Azure refused the request",
        text: "Rate limit or quota reached. Check the Azure portal.",
      });
      return;
    case "bad-request":
      showToast({
        title: "Azure rejected the request",
        text: "Likely an invalid voice or text.",
      });
      return;
    case "server":
      showToast({
        title: "Azure TTS is having problems",
        text: "Try again in a moment.",
      });
      return;
    case "network":
      showToast({
        title: "Couldn't reach Azure",
        text: "Check your connection or region in options.",
        action: { label: "Open options →", onClick: openOptions },
      });
      return;
    default:
      showToast({
        title: "Onyomi error",
        text: message || kind || "unknown",
      });
  }
}

function playAudio(audio, voiceId) {
  const bytes = new Uint8Array(audio);
  if (bytes.byteLength === 0) {
    showToast({ title: "Couldn't play audio", text: "Empty response from server." });
    return;
  }
  stopCurrentAudio();
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const el = new Audio(url);
  currentAudio = { el, url };
  setVoiceLabel(voiceId || "");
  el.onended = () => {
    if (currentAudio?.el !== el) return;
    URL.revokeObjectURL(url);
    currentAudio = null;
    isPlaying = false;
    applyState();
    if (!getSelectionInfo()) hidePill();
  };
  el.onerror = () => {
    if (currentAudio?.el === el) {
      URL.revokeObjectURL(url);
      currentAudio = null;
    }
    isPlaying = false;
    applyState();
    showToast({ title: "Couldn't play returned audio", text: "" });
  };
  el.play()
    .then(() => {
      if (currentAudio?.el !== el) return;
      isPlaying = true;
      applyState();
    })
    .catch(() => {
      if (currentAudio?.el === el) {
        URL.revokeObjectURL(url);
        currentAudio = null;
      }
      isPlaying = false;
      applyState();
      showToast({ title: "Couldn't play returned audio", text: "" });
    });
}

function showToast({ title, text, action }) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "onyomi-toast";
    toastEl.innerHTML = `
      <div class="onyomi-toast-icon">${SVG_WARN}</div>
      <div class="onyomi-toast-body">
        <div class="onyomi-toast-title"></div>
        <div class="onyomi-toast-text"></div>
        <button class="onyomi-toast-action" type="button" style="display:none"></button>
      </div>
      <button class="onyomi-toast-close" type="button" aria-label="Close">${SVG_CLOSE}</button>
    `;
    document.documentElement.appendChild(toastEl);
    toastEl.querySelector(".onyomi-toast-close").addEventListener("click", hideToast);
  }
  toastEl.querySelector(".onyomi-toast-title").textContent = title;
  const textEl = toastEl.querySelector(".onyomi-toast-text");
  textEl.textContent = text;
  textEl.style.display = text ? "block" : "none";
  const actionBtn = toastEl.querySelector(".onyomi-toast-action");
  if (action) {
    actionBtn.style.display = "inline-block";
    actionBtn.textContent = action.label;
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      action.onClick();
      hideToast();
    };
  } else {
    actionBtn.style.display = "none";
    actionBtn.onclick = null;
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
    showPill(info.rect);
  }
  if (currentText) playCurrent();
});

document.addEventListener("selectionchange", onSelectionChange);
