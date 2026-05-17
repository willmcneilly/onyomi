import * as cache from "./cache-store.js";

const RECENT_WINDOW_MS = 60_000;

const $ = (id) => document.getElementById(id);

let allEntries = [];
let voiceMap = {};
let currentView = "phrase";
let searchTerm = "";
let currentAudio = null;

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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function relativeTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function absoluteTime(ts) {
  return new Date(ts).toLocaleString();
}

function lookupVoice(voiceId) {
  if (voiceMap[voiceId]) return voiceMap[voiceId];
  const m = voiceId.match(/-([A-Za-z]+)Neural$/);
  return { id: voiceId, displayName: m ? m[1] : voiceId, localName: "", gender: "" };
}

function matchesSearch(entry, filter) {
  if (!filter) return true;
  if (entry.text.toLowerCase().includes(filter)) return true;
  const v = lookupVoice(entry.voice);
  if ((v.displayName || "").toLowerCase().includes(filter)) return true;
  if ((v.localName || "").toLowerCase().includes(filter)) return true;
  if (entry.voice.toLowerCase().includes(filter)) return true;
  return false;
}

function groupByPhrase(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.text)) groups.set(e.text, []);
    groups.get(e.text).push(e);
  }
  const arr = [];
  for (const [text, voices] of groups) {
    voices.sort((a, b) => b.createdAt - a.createdAt);
    arr.push({
      text,
      voices,
      totalSize: voices.reduce((s, v) => s + v.size, 0),
      latestCreatedAt: voices[0].createdAt,
    });
  }
  arr.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
  return arr;
}

function renderSummary() {
  const totalBytes = allEntries.reduce((s, e) => s + e.size, 0);
  const phraseCount = new Set(allEntries.map((e) => e.text)).size;
  const filtered = searchTerm ? allEntries.filter((e) => matchesSearch(e, searchTerm)) : allEntries;
  const filteredNote = searchTerm ? ` · ${filtered.length} matching` : "";
  $("summary").textContent = `${allEntries.length} ${allEntries.length === 1 ? "entry" : "entries"} · ${phraseCount} ${phraseCount === 1 ? "phrase" : "phrases"} · ${formatSize(totalBytes)}${filteredNote}`;
}

function renderEmpty(show) {
  $("empty").style.display = show ? "block" : "none";
  $("phraseView").style.display = !show && currentView === "phrase" ? "block" : "none";
  $("flatView").style.display = !show && currentView === "flat" ? "table" : "none";
}

function playSvg() {
  return '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1l-7.6-4.8a.6.6 0 0 0-.92.5z"/></svg>';
}
function trashSvg() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5"/></svg>';
}

function renderPhraseView(entries) {
  const groups = groupByPhrase(entries);
  const container = $("phraseView");
  if (groups.length === 0) {
    container.innerHTML = "";
    return;
  }
  const now = Date.now();
  container.innerHTML = groups
    .map((g) => {
      const chips = g.voices
        .map((v) => {
          const meta = lookupVoice(v.voice);
          const recent = now - v.createdAt < RECENT_WINDOW_MS ? " recent" : "";
          return `
            <span class="chip${recent}">
              <span class="jp">${escapeHtml(meta.localName || meta.displayName)}</span>
              <span>${escapeHtml(meta.displayName)}</span>
              <span class="meta">· ${formatSize(v.size)}</span>
              <span class="meta" title="${escapeHtml(absoluteTime(v.createdAt))}">· ${relativeTime(v.createdAt)}</span>
              <button class="chip-play" data-key="${escapeHtml(v.key)}" title="Play">${playSvg()}</button>
            </span>`;
        })
        .join("");
      const phraseKeys = g.voices.map((v) => v.key).join(",");
      return `
        <div class="phrase-row">
          <div class="phrase-main">
            <div class="phrase-text">${escapeHtml(g.text)}</div>
            <div class="chips">${chips}</div>
          </div>
          <div class="phrase-side">
            <div class="voices-count">${g.voices.length} voice${g.voices.length > 1 ? "s" : ""}</div>
            <div class="total-size">${formatSize(g.totalSize)}</div>
            <button class="phrase-trash" data-keys="${phraseKeys}" title="Delete all variants">${trashSvg()}</button>
          </div>
        </div>`;
    })
    .join("");
}

function renderFlatView(entries) {
  const tbody = $("flatBody");
  tbody.innerHTML = entries
    .map((e) => {
      const meta = lookupVoice(e.voice);
      return `
        <tr>
          <td class="flat-text" title="${escapeHtml(e.text)}">${escapeHtml(e.text)}</td>
          <td class="flat-voice">
            <span class="jp">${escapeHtml(meta.localName || "")}</span>
            <span>${escapeHtml(meta.displayName)}</span>
          </td>
          <td title="${escapeHtml(absoluteTime(e.createdAt))}">${relativeTime(e.createdAt)}</td>
          <td>${formatSize(e.size)}</td>
          <td class="actions">
            <button class="row-btn play" data-key="${escapeHtml(e.key)}" title="Play">${playSvg()}</button>
            <button class="row-btn delete" data-key="${escapeHtml(e.key)}" title="Delete">${trashSvg()}</button>
          </td>
        </tr>`;
    })
    .join("");
}

function render() {
  renderSummary();
  if (allEntries.length === 0) {
    renderEmpty(true);
    return;
  }
  renderEmpty(false);

  const filtered = searchTerm ? allEntries.filter((e) => matchesSearch(e, searchTerm)) : allEntries;

  if (currentView === "phrase") {
    renderPhraseView(filtered);
  } else {
    renderFlatView(filtered);
  }

  $("viewPhrase").classList.toggle("active", currentView === "phrase");
  $("viewFlat").classList.toggle("active", currentView === "flat");
}

async function load() {
  const stored = await chrome.storage.local.get({ voices: [], cacheView: "phrase" });
  voiceMap = Object.fromEntries(stored.voices.map((v) => [v.id, v]));
  currentView = stored.cacheView === "flat" ? "flat" : "phrase";
  allEntries = await cache.list();
  render();
}

async function playEntry(key) {
  stopCurrentAudio();
  const entry = await cache.get(key);
  if (!entry) return;
  const url = URL.createObjectURL(entry.blob);
  const el = new Audio(url);
  currentAudio = { el, url };
  el.onended = () => {
    if (currentAudio?.el !== el) return;
    URL.revokeObjectURL(url);
    currentAudio = null;
  };
  el.onerror = () => {
    if (currentAudio?.el === el) {
      URL.revokeObjectURL(url);
      currentAudio = null;
    }
  };
  el.play().catch((e) => {
    if (currentAudio?.el === el) {
      URL.revokeObjectURL(url);
      currentAudio = null;
    }
    console.error("Onyomi cache: play rejected", e);
  });
}

async function deleteEntry(key) {
  await cache.del(key);
  await load();
}

async function deletePhrase(keys) {
  if (!confirm(`Delete ${keys.length} cached variant${keys.length > 1 ? "s" : ""}?`)) return;
  for (const key of keys) await cache.del(key);
  await load();
}

async function clearAll() {
  if (allEntries.length === 0) return;
  if (!confirm(`Delete all ${allEntries.length} cached audio entries?`)) return;
  await cache.clear();
  await load();
}

async function setView(view) {
  currentView = view;
  await chrome.storage.local.set({ cacheView: view });
  render();
}

$("search").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

$("viewPhrase").addEventListener("click", () => setView("phrase"));
$("viewFlat").addEventListener("click", () => setView("flat"));
$("clearAll").addEventListener("click", clearAll);

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.body.addEventListener("click", (e) => {
  const phraseTrash = e.target.closest(".phrase-trash");
  if (phraseTrash) {
    const keys = phraseTrash.dataset.keys.split(",").filter(Boolean);
    deletePhrase(keys);
    return;
  }
  const playBtn = e.target.closest("[data-key]");
  if (!playBtn) return;
  if (playBtn.classList.contains("delete")) {
    deleteEntry(playBtn.dataset.key);
  } else {
    playEntry(playBtn.dataset.key);
  }
});

load();
