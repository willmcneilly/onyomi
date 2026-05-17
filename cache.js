import * as cache from "./cache-store.js";

const $ = (id) => document.getElementById(id);
let allEntries = [];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  let rel;
  if (diff < 60) rel = `${Math.floor(diff)}s ago`;
  else if (diff < 3600) rel = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) rel = `${Math.floor(diff / 3600)}h ago`;
  else rel = `${Math.floor(diff / 86400)}d ago`;
  return { rel, abs: d.toLocaleString() };
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  const filter = $("search").value.trim().toLowerCase();
  const filtered = filter
    ? allEntries.filter((e) => e.text.toLowerCase().includes(filter))
    : allEntries;

  const tbody = $("tbody");
  tbody.innerHTML = "";

  if (allEntries.length === 0) {
    $("table").style.display = "none";
    $("empty").style.display = "block";
  } else {
    $("empty").style.display = "none";
    $("table").style.display = "table";

    for (const e of filtered) {
      const date = formatDate(e.createdAt);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text" title="${escapeHtml(e.text)}">${escapeHtml(e.text)}</td>
        <td>${escapeHtml(e.voice)}</td>
        <td title="${date.abs}">${date.rel}</td>
        <td>${formatSize(e.size)}</td>
        <td class="actions">
          <button class="icon play" data-key="${e.key}" title="Play">▶</button>
          <button class="icon delete" data-key="${e.key}" title="Delete">🗑</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  const totalBytes = allEntries.reduce((s, e) => s + e.size, 0);
  const filteredNote = filter ? ` (showing ${filtered.length})` : "";
  $("summary").textContent =
    `${allEntries.length} ${allEntries.length === 1 ? "entry" : "entries"} · ${formatSize(totalBytes)}${filteredNote}`;
}

async function load() {
  allEntries = await cache.list();
  render();
}

async function playEntry(key) {
  const entry = await cache.get(key);
  if (!entry) return;
  const url = URL.createObjectURL(entry.blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => URL.revokeObjectURL(url);
  audio.play().catch((e) => console.error("Onyomi cache: play rejected", e));
}

async function deleteEntry(key) {
  await cache.del(key);
  await load();
}

async function clearAll() {
  if (allEntries.length === 0) return;
  if (!confirm(`Delete all ${allEntries.length} cached audio entries?`)) return;
  await cache.clear();
  await load();
}

$("search").addEventListener("input", render);
$("clearAll").addEventListener("click", clearAll);

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn?.dataset.key) return;
  if (btn.classList.contains("play")) playEntry(btn.dataset.key);
  else if (btn.classList.contains("delete")) deleteEntry(btn.dataset.key);
});

load();
