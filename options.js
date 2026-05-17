import { adapter } from "./tts/index.js";

const FALLBACK_VOICE = "ja-JP-NanamiNeural";

const DEFAULTS = {
  ttsCredentials: { key: "", region: "uksouth" },
  defaultVoice: FALLBACK_VOICE,
  voices: [],
  playbackSpeed: 1.0,
  selectionCharLimit: 500,
};

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  $("key").value = stored.ttsCredentials.key || "";
  $("region").value = stored.ttsCredentials.region || DEFAULTS.ttsCredentials.region;
  $("speed").value = stored.playbackSpeed;
  $("charLimit").value = stored.selectionCharLimit;
  renderVoices(stored.voices, stored.defaultVoice);
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
  flashSaved();
}

function flashSaved() {
  const msg = $("saveMsg");
  msg.classList.add("show");
  setTimeout(() => msg.classList.remove("show"), 1500);
}

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderVoices(voices, defaultVoiceId) {
  const container = $("voices");
  if (!voices?.length) {
    container.innerHTML =
      '<div class="hint" style="padding: 12px">Connect to Azure first to load the voice list.</div>';
    return;
  }
  container.innerHTML = voices
    .map(
      (v) => `
      <label class="voice-row">
        <input type="radio" name="voice" value="${escapeHtml(v.id)}" ${
          v.id === defaultVoiceId ? "checked" : ""
        } />
        <div class="voice-name">
          <span class="display">${escapeHtml(v.displayName)}</span>
          <span class="local">${escapeHtml(v.localName || "")}</span>
          <div class="meta">${escapeHtml(v.gender || "")} · ${escapeHtml(v.id)}</div>
        </div>
        <button type="button" class="preview" data-voice="${escapeHtml(v.id)}">▶ preview</button>
      </label>`
    )
    .join("");
}

async function previewVoice(voiceId) {
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
  el.onended = () => URL.revokeObjectURL(url);
  el.play().catch((e) => console.error("Onyomi preview play failed:", e));
}

async function testConnection() {
  setStatus("Testing…", "");
  $("test").disabled = true;
  try {
    const credentials = {
      key: $("key").value.trim(),
      region: $("region").value.trim() || DEFAULTS.ttsCredentials.region,
    };
    const result = await adapter.testConnection(credentials);
    if (!result.ok) {
      setStatus(`❌ ${result.reason}`, "err");
      return;
    }
    setStatus(
      `✅ Connected. ${result.jaVoiceCount} Japanese voices available (${result.totalVoices} total). Loading…`,
      "ok"
    );
    const voices = await adapter.listVoices(credentials);
    const { defaultVoice } = await chrome.storage.local.get({ defaultVoice: FALLBACK_VOICE });
    const newDefault = voices.some((v) => v.id === defaultVoice) ? defaultVoice : voices[0].id;
    await chrome.storage.local.set({ voices, defaultVoice: newDefault });
    renderVoices(voices, newDefault);
    setStatus(`✅ Connected. ${voices.length} Japanese voices loaded.`, "ok");
  } catch (e) {
    setStatus(`❌ ${e.message}`, "err");
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

$("voices").addEventListener("click", (e) => {
  const btn = e.target.closest("button.preview");
  if (!btn) return;
  e.preventDefault();
  previewVoice(btn.dataset.voice);
});

loadSettings();
