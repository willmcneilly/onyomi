export class TTSError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function voicesUrl(region) {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
}

function ttsUrl(region) {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml({ text, voice, speed }) {
  const escaped = escapeXml(text);
  const inner =
    typeof speed === "number" && speed !== 1
      ? `<prosody rate="${speed.toFixed(2)}">${escaped}</prosody>`
      : escaped;
  return (
    `<speak version="1.0" xml:lang="ja-JP">` +
    `<voice name="${voice}">${inner}</voice>` +
    `</speak>`
  );
}

function mapStatusToKind(status) {
  if (status === 401) return "auth";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 415) return "bad-request";
  if (status >= 500) return "server";
  return "unknown";
}

const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new TTSError("network", "Request timed out after 10s");
    }
    throw new TTSError("network", e.message || "Network request failed");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVoices({ key, region }) {
  if (!key) throw new TTSError("auth", "Missing Azure key");
  if (!region) throw new TTSError("bad-request", "Missing Azure region");

  const res = await fetchWithTimeout(voicesUrl(region), {
    headers: { "Ocp-Apim-Subscription-Key": key },
  });

  if (!res.ok) {
    throw new TTSError(mapStatusToKind(res.status), `Azure returned status ${res.status}`);
  }
  return res.json();
}

function toVoice(v) {
  return {
    id: v.ShortName,
    displayName: v.DisplayName,
    localName: v.LocalName,
    gender: v.Gender,
    locale: v.Locale,
    styles: v.StyleList || [],
    sampleRateHz: parseInt(v.SampleRateHertz, 10),
  };
}

async function testConnection(credentials) {
  try {
    const all = await fetchVoices(credentials);
    const ja = all.filter((v) => v.Locale === "ja-JP");
    return { ok: true, totalVoices: all.length, jaVoiceCount: ja.length };
  } catch (e) {
    const reason =
      e.kind === "auth"
        ? "Azure rejected the key — check the key and region match"
        : e.kind === "network"
        ? `Couldn't reach Azure: ${e.message}`
        : e.message;
    return { ok: false, kind: e.kind || "unknown", reason };
  }
}

async function listVoices(credentials) {
  const all = await fetchVoices(credentials);
  return all.filter((v) => v.Locale === "ja-JP").map(toVoice);
}

async function speak({ key, region, text, voice, speed }) {
  if (!key) throw new TTSError("auth", "Missing Azure key");
  if (!region) throw new TTSError("bad-request", "Missing Azure region");
  if (!text) throw new TTSError("bad-request", "Empty text");
  if (!voice) throw new TTSError("bad-request", "No voice specified");

  const ssml = buildSsml({ text, voice, speed });

  const res = await fetchWithTimeout(ttsUrl(region), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
    },
    body: ssml,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body ? ` — ${body.slice(0, 300)}` : "";
    throw new TTSError(
      mapStatusToKind(res.status),
      `Azure returned status ${res.status}${detail}`
    );
  }
  return res.arrayBuffer();
}

export const adapter = {
  providerId: "azure",
  testConnection,
  listVoices,
  speak,
};
