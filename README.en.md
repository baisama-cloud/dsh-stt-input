[中文](README.md) · **English**

# dsh-stt-input

Speech-to-text voice input for the **DeepSeek Harness (DSH)** web GUI.

Click the 🎤 mic button beside the composer, speak, click again — the transcript
is written straight into the input box. The STT engine and model are selectable
in **Settings → 语音输入 (Voice Input)**.

## Features

- **Two engines**
  - **Browser local** — uses the browser's built-in Web Speech API
    (`SpeechRecognition`, Chrome/Edge). Zero configuration, no API key,
    live interim results appear in the input box as you speak.
  - **API** — records with `MediaRecorder` and transcribes through any
    **OpenAI-compatible** `/v1/audio/transcriptions` endpoint (OpenAI,
    Groq, custom).
- **Selectable model** — `whisper-1` (OpenAI), `whisper-large-v3`,
  `whisper-large-v3-turbo`, `distil-whisper-large-v3-en` (Groq), or a custom
  model name.
- **Configurable** — service preset (OpenAI / Groq / custom), API base URL,
  API key, recognition language, and insert mode (append to / replace the
  existing draft).
- **Live status** — a pill under the composer shows recording time,
  transcribing state, and errors.
- **Privacy** — the API key is kept in page memory only and is never persisted
  or logged; the non-secret config survives reloads via `localStorage`.

## Install

Build the tarball and install it into your DSH web profile (same flow as other
`dsh-*` plugins):

```bash
pnpm pack
# copy dsh-stt-input-*.tgz into the web profile and add the dependency,
# e.g. under ~/.dsh/profiles/web: pnpm add ../path/to/dsh-stt-input-0.1.0.tgz
# then restart `dsh web`.
```

The plugin registers:

- a mic button in the composer tool row (`conversation.input.left`),
- a status pill under the composer (`conversation.composer.dock`),
- a settings page (`settings.section` → 语音输入).

## Usage

1. Open **Settings → 语音输入** and pick an engine.
   - Browser local: nothing else needed (Chrome/Edge).
   - API: choose a preset (OpenAI or Groq), pick the model, and paste your
     API key. Groq's `whisper-large-v3` is currently free.
2. Click the 🎤 mic button in the composer to start, speak, and click again to
   stop. The transcript lands in the input box; press Enter to send.

> The browser engine needs Chrome or Edge (Web Speech API). Firefox falls back
> to the API engine.

## How it works

```
┌──────────┐  click 🎤        ┌───────────────┐
│  Client  │ ───────────────▶ │ MediaRecorder │  (api engine)
│ (browser)│                  │ SpeechRecog.  │  (browser engine)
└──────────┘                  └──────┬────────┘
      ▲                              ▼
      │ setDraft(text)         base64 audio (JSON)
      │                 POST /stt-input/transcribe
      │                              │
┌─────┴──────┐              ┌───────▼────────┐
│ input box  │ ◀────────────│  Host (Node)   │
└────────────┘   {ok,text}  │  fetch → /v1/   │
                            │  audio/transcr. │
                            └─────────────────┘
```

The client (`lib/client.js`) captures audio and posts base64 JSON to the host
route `/stt-input/transcribe`. The host (`lib/index.js`) decodes the audio and
uploads it as `multipart/form-data` to `${baseUrl}/v1/audio/transcriptions`
using Node ≥ 18 global `fetch` / `FormData` / `Blob`.

## License

MIT
