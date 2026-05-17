# Onyomi

A personal Chromium extension that plays high-quality spoken Japanese for any
selected text on a webpage. Built to support ear-training during written-output
practice with LLMs — when an unknown word appears, you can hear it spoken in a
native voice rather than risk locking in a wrong mental pronunciation.

The name is a play on the kanji term *on'yomi* (音読み), the Chinese-derived
reading of a character — read literally as "sound reading," which is what the
extension does for any selection.

## How it works

1. Select some Japanese on any webpage.
2. A small dark pill appears near the selection with a gold **▶** play button
   and a **🔀** random-voice button.
3. Click ▶ to hear the selection in your default voice; click 🔀 to hear it
   in a different voice picked from your account's full ja-JP roster.
4. Or use the global hotkey **⇧⌘Y** (rebind via `chrome://extensions/shortcuts`).

Every clip is cached locally in IndexedDB, so replaying a phrase is instant
and free.

## Install

Onyomi is loaded as an unpacked extension (no store distribution).

1. Clone this repo somewhere local.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** → select the repo directory.
5. The gold-pebble icon appears in your extensions menu. Pin it to the toolbar
   for the cache shortcut (left-click on the icon opens the cache inspector).

## Set up an Azure Speech key

Onyomi uses Azure's Speech Service for high-quality TTS. The free tier (F0)
gives you 500,000 characters per month — far more than personal use will hit.

1. [Sign up for an Azure account](https://azure.microsoft.com/en-gb/free/) if
   you don't have one.
2. [Create a Speech resource](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices)
   — pick a region near you (e.g. `uksouth`), name it `onyomi-tts`, choose the
   **Free F0** pricing tier.
3. From the resource page → **Keys and Endpoint** → copy **KEY 1**.
4. Open Onyomi options (right-click the toolbar icon → Options).
5. Paste the key, set the region, click **Test connection**. After a green
   ✓ Connected, your ja-JP voices appear below — pick a default and **Save
   changes**.

The key is stored in `chrome.storage.local`, isolated per-extension, never
sent anywhere except Azure.

## Customise

The options page exposes:

- **Default voice** — which voice plays on ▶ by default. Preview each row
  with the inline ▶ Preview button.
- **Playback speed** — 0.6× to 1.4×. Useful for slowing down new vocab.
- **Selection character cap** — selections longer than this require a
  confirm-click before playing (guards against accidental whole-page
  selections that would burn API budget).

The cache inspector ([cache.html](cache.html), reachable from the toolbar icon
or from the options page) lists every cached audio entry. Two views:

- **By phrase** (default) — phrases grouped, each with chips for the voices
  you've heard it in. The most-recently-played chip is gold-tinted.
- **Flat** — one row per entry. Sort/filter by text or voice name.

Per-chip ▶ buttons play directly from IndexedDB, no Azure call.

## Project layout

```
manifest.json         Manifest V3 declaration
background.js         Service worker — message dispatch, cache writes,
                      hotkey + context menu handling
content.js            Content script — floating pill, selection detection,
                      audio playback in the page
content.css           Floating pill + toast styles (dark+gold)
options.html / .js    Options page (off-white surface)
cache.html / .js      Cache inspector (off-white surface)
cache-store.js        IndexedDB module, shared by SW + cache page
tokens.css            Design tokens (CSS custom properties) and bundled
                      @font-face declarations
tts/index.js          Provider-agnostic adapter interface
tts/azure.js          Azure Speech implementation (the only file that
                      knows about Azure — adapter pattern)
fonts/                Bundled Geist + Klee One WOFF2 files (~7 MB; Klee
                      One covers full Japanese, loaded on-demand by the
                      browser via unicode-range)
icons/                Speech-bubble mark at 16/32/48/128 + source SVG
```

### Adapter pattern

Anything Azure-specific lives in [tts/azure.js](tts/azure.js). The rest of
the codebase imports from [tts/index.js](tts/index.js) and speaks only to
the adapter interface (`speak`, `listVoices`, `testConnection`, `TTSError`
with typed `.kind`). Swapping in Google Cloud TTS, ElevenLabs, or a local
VOICEVOX would be a one-file change plus a setting in options.

## Known limitations

- **Furigana** — pages that use `<ruby><rt>…</rt></ruby>` markup (NHK Easy,
  many learning sites) cause Onyomi to play the kanji and the kana readings
  back-to-back, doubling the audio. Workaround for now: avoid those sites or
  paste the text into a furigana-free page.
- **Icon centring** — the 音 in the rasterized PNGs sits slightly high in
  the pebble due to an ImageMagick / SVG `dominant-baseline` quirk. Logged
  for a Figma redo.
- **Klee One in the floating pill** — the now-playing voice label
  (e.g. `Nanami 七海`) falls back to Hiragino in the content script context
  because content scripts can't load extension-bundled fonts without
  `web_accessible_resources`. The kanji in the page header and cache page
  do render in Klee One.

## Stack

Vanilla JavaScript, no build step. Edit a file, reload the extension card
on `chrome://extensions`. The HTML pages use ES modules natively.

## Credits / fonts

- [Geist](https://github.com/vercel/geist-font) by Vercel — SIL OFL 1.1
- [Klee One](https://fonts.google.com/specimen/Klee+One) by Fontworks
  (designer Tomokazu Murayama) — SIL OFL 1.1

Both fonts are bundled locally under [fonts/](fonts/) — no Google Fonts CDN
calls.
