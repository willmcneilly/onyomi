import { adapter, TTSError } from "./tts/index.js";
import * as cache from "./cache-store.js";

const FALLBACK_VOICE = "ja-JP-NanamiNeural";

console.log("Onyomi service worker started", new Date().toISOString());

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Onyomi installed:", details.reason);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-cache",
      title: "Open cache inspector",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "open-options",
      title: "Options",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-cache") {
    chrome.tabs.create({ url: chrome.runtime.getURL("cache.html") });
  } else if (info.menuItemId === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("cache.html") });
});

let lastRandomVoice = null;

function pickRandomVoice(voices, defaultId) {
  if (!voices?.length) return FALLBACK_VOICE;
  const exclude = new Set([defaultId, lastRandomVoice].filter(Boolean));
  let pool = voices.filter((v) => !exclude.has(v.id));
  if (pool.length === 0) pool = voices.filter((v) => v.id !== defaultId);
  if (pool.length === 0) pool = voices;
  const chosen = pool[Math.floor(Math.random() * pool.length)].id;
  lastRandomVoice = chosen;
  return chosen;
}

async function speakWithRetry(args) {
  try {
    return await adapter.speak(args);
  } catch (e) {
    if (e.kind === "rate-limited") {
      console.warn(`Onyomi: 429 from ${adapter.providerId}, retrying once after 1s`);
      await new Promise((r) => setTimeout(r, 1000));
      return adapter.speak(args);
    }
    throw e;
  }
}

async function resolveVoice({ voice, random }) {
  if (voice) return voice;
  const { defaultVoice, voices } = await chrome.storage.local.get({
    defaultVoice: FALLBACK_VOICE,
    voices: [],
  });
  if (random) return pickRandomVoice(voices, defaultVoice);
  return defaultVoice || FALLBACK_VOICE;
}

async function speak({ text, voice, random }) {
  const { ttsCredentials, playbackSpeed } = await chrome.storage.local.get([
    "ttsCredentials",
    "playbackSpeed",
  ]);
  if (!ttsCredentials?.key) {
    throw new TTSError("auth", "No TTS key configured — open Onyomi options");
  }

  const voiceId = await resolveVoice({ voice, random });
  const key = await cache.hash(text, voiceId, adapter.providerId);

  const hit = await cache.get(key);
  if (hit) {
    return hit.blob.arrayBuffer();
  }

  const audio = await speakWithRetry({
    ...ttsCredentials,
    text,
    voice: voiceId,
    speed: playbackSpeed || 1.0,
  });

  const blob = new Blob([audio], { type: "audio/mpeg" });
  await cache.put({
    key,
    text,
    voice: voiceId,
    provider: adapter.providerId,
    blob,
    size: blob.size,
    createdAt: Date.now(),
  });

  return audio;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type !== "speak") return false;

  speak(msg).then(
    (audio) =>
      sendResponse({
        ok: true,
        // chrome.runtime.sendMessage serialization can drop ArrayBuffer across
        // SW ↔ content-script boundaries; send as a JSON-safe byte array.
        audio: Array.from(new Uint8Array(audio)),
        provider: adapter.providerId,
      }),
    (err) => {
      console.error("Onyomi speak failed:", err);
      sendResponse({
        ok: false,
        kind: err.kind || "unknown",
        message: err.message || String(err),
      });
    }
  );
  return true; // keep the message channel open for the async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "speak-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "speak-selection" });
  } catch (e) {
    console.warn("Onyomi: no content script on active tab", tab.url, e.message);
  }
});

// Dev hook: call from the service-worker DevTools console.
// chrome.runtime.sendMessage can't deliver to the same context that sends it,
// so for SW-console testing we expose speak() directly.
globalThis.onyomi = { speak };
