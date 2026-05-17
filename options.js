import { adapter } from "./tts/index.js";

const FALLBACK_VOICE = "ja-JP-NanamiNeural";

const DEFAULTS = {
  ttsCredentials: { key: "", region: "uksouth" },
  defaultVoice: FALLBACK_VOICE,
  voices: [],
  lastTestedAt: 0,
  playbackSpeed: 1.0,
  selectionCharLimit: 500,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 30) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  $("key").value = stored.ttsCredentials.key || "";
  $("region").value = stored.ttsCredentials.region || DEFAULTS.ttsCredentials.region;
  $("speed").value = stored.playbackSpeed;
  $("speedValue").textContent = `${Number(stored.playbackSpeed).toFixed(2)}×`;
  $("charLimit").value = stored.selectionCharLimit;
  renderVoices(stored.voices, stored.defaultVoice);
  renderConnectedStatus(stored.voices, stored.lastTestedAt);
  $("version").textContent = `v${chrome.runtime.getManifest().version} · saved locally`;
}

async function saveSettings() {
  const checked = document.querySelector('input[name="voice"]:checked');
  await chrome.storage.local.set({
    ttsCredentials: {
      key: $("key").value.trim(),
      region: $("region").value.trim() || DEFAULTS.ttsCredentials.region,
    },
    defaultVoice: checked ? checked.value : FALLBACK_VOICE,
    playbackSpeed: parseFloat($("speed").value) || DEFAULTS.playbackSpeed,
    selectionCharLimit: parseInt($("charLimit").value, 10) || DEFAULTS.selectionCharLimit,
  });
  const msg = $("saveMsg");
  msg.classList.add("show");
  setTimeout(() => msg.classList.remove("show"), 1500);
}

function setStatus(text, cls) {
  const el = $("status");
  el.className = cls || "";
  if (text) {
    el.innerHTML = `<span class="dot"></span>${escapeHtml(text)}`;
  } else {
    el.textContent = "";
  }
}

function renderConnectedStatus(voices, lastTestedAt) {
  if (!voices?.length || !lastTestedAt) return;
  setStatus(`Connected — ${voices.length} voices, ${relativeTime(lastTestedAt)}`, "ok");
}

function renderVoices(voices, defaultVoiceId) {
  const container = $("voices");
  if (!voices?.length) {
    container.innerHTML =
      '<div class="voices-empty">Connect to Azure to load the voice list.</div>';
    return;
  }
  container.innerHTML = voices
    .map((v) => {
      const avatar = (v.localName || v.displayName || "?").slice(0, 1);
      const checked = v.id === defaultVoiceId;
      return `
        <label class="voice-row${checked ? " checked" : ""}" data-voice="${escapeHtml(v.id)}">
          <input type="radio" name="voice" value="${escapeHtml(v.id)}"${checked ? " checked" : ""} />
          <span class="radio-dot"></span>
          <span class="avatar">${escapeHtml(avatar)}</span>
          <div class="voice-info">
            <div class="voice-line">
              <span class="name-en">${escapeHtml(v.displayName || v.id)}</span>
              <span class="name-jp">${escapeHtml(v.localName || "")}</span>
              <span class="gender">${escapeHtml(v.gender || "")}</span>
            </div>
            <div class="voice-id">${escapeHtml(v.id)}</div>
          </div>
          <button type="button" class="voice-preview" data-voice="${escapeHtml(v.id)}">
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1l-7.6-4.8a.6.6 0 0 0-.92.5z"/></svg>
            Preview
          </button>
        </label>`;
    })
    .join("");
}

let currentPreview = null;

function stopCurrentPreview() {
  if (!currentPreview) return;
  const { el, url } = currentPreview;
  el.onended = null;
  el.onerror = null;
  try {
    el.pause();
  } catch (_) {}
  URL.revokeObjectURL(url);
  currentPreview = null;
}

async function previewVoice(voiceId) {
  stopCurrentPreview();
  const response = await chrome.runtime.sendMessage({
    type: "speak",
    text: "こんにちは",
    voice: voiceId,
  });
  if (!response?.ok) {
    console.error("Onyomi preview failed:", response);
    return;
  }
  const bytes = new Uint8Array(response.audio);
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const el = new Audio(url);
  currentPreview = { el, url };
  el.onended = () => {
    if (currentPreview?.el !== el) return;
    URL.revokeObjectURL(url);
    currentPreview = null;
  };
  el.play().catch((e) => {
    if (currentPreview?.el === el) {
      URL.revokeObjectURL(url);
      currentPreview = null;
    }
    console.error("Onyomi preview play failed:", e);
  });
}

async function testConnection() {
  setStatus("Testing…");
  $("test").disabled = true;
  try {
    const credentials = {
      key: $("key").value.trim(),
      region: $("region").value.trim() || DEFAULTS.ttsCredentials.region,
    };
    const result = await adapter.testConnection(credentials);
    if (!result.ok) {
      setStatus(result.reason, "err");
      return;
    }
    setStatus(`Loading ${result.jaVoiceCount} voices…`, "ok");
    const voices = await adapter.listVoices(credentials);
    const { defaultVoice } = await chrome.storage.local.get({ defaultVoice: FALLBACK_VOICE });
    const newDefault = voices.some((v) => v.id === defaultVoice) ? defaultVoice : voices[0].id;
    const now = Date.now();
    await chrome.storage.local.set({ voices, defaultVoice: newDefault, lastTestedAt: now });
    renderVoices(voices, newDefault);
    renderConnectedStatus(voices, now);
  } catch (e) {
    setStatus(e.message, "err");
  } finally {
    $("test").disabled = false;
  }
}

function toggleKeyVisibility() {
  const input = $("key");
  const btn = $("toggleKey");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Hide";
  } else {
    input.type = "password";
    btn.textContent = "Show";
  }
}

$("test").addEventListener("click", testConnection);
$("save").addEventListener("click", saveSettings);
$("toggleKey").addEventListener("click", toggleKeyVisibility);
$("speed").addEventListener("input", (e) => {
  $("speedValue").textContent = `${Number(e.target.value).toFixed(2)}×`;
});

$("voices").addEventListener("click", (e) => {
  const previewBtn = e.target.closest(".voice-preview");
  if (previewBtn) {
    e.preventDefault();
    e.stopPropagation();
    previewVoice(previewBtn.dataset.voice);
    return;
  }
  // Let the radio change happen, then update the row classes
  setTimeout(() => {
    const checked = document.querySelector('input[name="voice"]:checked');
    document.querySelectorAll(".voice-row").forEach((row) => {
      row.classList.toggle("checked", row.dataset.voice === checked?.value);
    });
  }, 0);
});

loadSettings();
