# Backend Pipeline

**[中文](backend-pipeline.zh.md)**

This page describes the current backend behavior as implemented in the repository today. It is intentionally implementation-accurate and does not describe future ideas.

## Overview

Podcast Summer currently supports two input modes:

- URL mode: the frontend sends a podcast or audio link to `POST /api/process-podcast`.
- Local file mode: the frontend uploads audio to `POST /api/upload-audio`, then starts processing through `POST /api/process-local-file`.

In both modes, the web app opens an SSE connection at `GET /api/progress/:sessionId` so the server can stream progress updates back to the UI.

The practical difference between the two modes is:

- URL mode can resolve podcast pages, RSS feeds, and direct audio URLs, and it can pass through a public direct audio URL for `fun_asr_file_diarization`.
- Local file mode works on a temporary uploaded file and cannot use `fun_asr_file_diarization`, because that backend requires a public direct audio URL.

## End-to-End Pipeline

### 1. Frontend request entrypoints

- URL mode calls `POST /api/process-podcast`.
- Local file mode first uploads the file to `POST /api/upload-audio`.
- After upload, local file mode calls `POST /api/process-local-file`.
- The frontend reads latest and historical runs through:
  - `GET /api/latest-result`
  - `GET /api/history`
  - `GET /api/history/:historyId`
  - `DELETE /api/history/:historyId`

### 2. URL resolution or file upload

In URL mode, the server tries to resolve the input into a playable audio source:

- direct audio URLs are used as-is
- Apple Podcasts goes through `iTunes API -> RSS -> enclosure`
- Xiaoyuzhou first tries page metadata, then RSS-based fallbacks
- generic podcast pages try RSS detection, HTML extraction, and direct audio patterns

URL mode explicitly rejects YouTube and Bilibili video pages. The current guidance is to use RSS, a direct audio URL, or upload exported audio instead.

In local file mode, the uploaded file is stored under `server/temp` and then passed into the same transcription pipeline.

### 3. Audio download and duration estimation

In URL mode, once a direct audio URL is found, the server downloads it into `server/temp`.

Before or after download, the server estimates duration from file size. This estimate is mainly used for progress UI and does not change backend selection.

### 4. ASR selection and execution

The main transcription entry is `processAudioWithOpenAI(...)`, which normalizes the requested backend and either:

- runs that specific backend, or
- runs `auto`, which tries backends in a fixed order until one is available and succeeds

Current `auto` order:

```text
fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local
```

Availability is checked before execution. Examples:

- DashScope-backed backends need `DASHSCOPE_API_KEY`
- `gemini_audio` needs `GEMINI_API_KEY` or `OPENAI_API_KEY`
- `whisperx_local` needs a Python runtime plus `PYANNOTE_TOKEN` or equivalent Hugging Face token
- `fun_asr_file_diarization` also needs `sourceAudioUrl`, which only URL mode can supply

### 5. Transcript post-processing

After raw ASR completes, the backend enters a shared transcript-finalization stage.

If the ASR backend does **not** provide native diarization:

- the transcript is optionally optimized for readability
- speaker turns are refined heuristically at the text level
- speaker labels are normalized into generic labels when possible

If the ASR backend **does** provide native diarization:

- the structured speaker/timing segments are preserved
- the system skips text-level speaker inference
- it may try to map generic speaker labels like `Speaker 1` to real names, but only when the transcript itself contains explicit evidence

### 6. Summary and translation

If the operation is `transcribe_summarize`, the finalized transcript is summarized.

Translation is generated only when the detected transcript language differs from the requested `outputLanguage`.

That means:

- transcript is always produced
- summary is conditional on the selected operation
- translation is conditional on language mismatch

### 7. Result saving and history

The final pipeline writes managed output files to `results/transcriptions`.

Depending on the run, the output set can include:

- `transcript`
- `original_transcript`
- `summary`
- `translation`

The server also persists:

- the latest result snapshot
- per-run history snapshots
- a compact history index used by the UI

## Backend Matrix

| Backend | What it does | Good fit | Key constraints |
| --- | --- | --- | --- |
| `auto` | Tries available backends in fallback order | default mode for most users | behavior depends on local env and configured keys |
| `fun_asr_file_diarization` | DashScope recorded-file transcription with native speaker diarization and provided timing | public podcast audio URLs where real speaker diarization matters | requires `DASHSCOPE_API_KEY` and a public direct audio URL |
| `qwen3_asr` | DashScope Qwen3-ASR through a Python wrapper with VAD chunking | longer audio with DashScope available | requires Python, `DASHSCOPE_API_KEY`, no native diarization |
| `gemini_audio` | Gemini file upload plus audio transcription | lowest-friction setup, especially for web-first usage | requires `GEMINI_API_KEY` or `OPENAI_API_KEY`, no native diarization |
| `fun_asr_realtime` | DashScope realtime-style recognition on converted WAV input | DashScope-based transcription without diarization needs | requires Python, `DASHSCOPE_API_KEY`, no native diarization |
| `whisperx_local` | local WhisperX + pyannote with aligned timestamps and speaker diarization | local files where real speaker diarization is required | requires Python, local model dependencies, and `PYANNOTE_TOKEN` |
| `whisper_local` | local faster-whisper transcription | simplest local fallback backend | requires Python and local Whisper dependencies, no native diarization |

## Constraints And Fallbacks

- Python is required for `whisper_local`, `whisperx_local`, `qwen3_asr`, `fun_asr_realtime`, and `fun_asr_file_diarization`.
- `fun_asr_file_diarization` requires a public direct audio URL and therefore is effectively URL-mode only.
- Real speaker diarization is currently available from `fun_asr_file_diarization` and `whisperx_local`.
- `auto` uses the fixed fallback order shown above and stops on the first backend that is both available and successful.
- URL mode does not support YouTube or Bilibili video pages.
- Text post-processing and summary generation still depend on the AI text client, even when the ASR backend itself is local or DashScope-based.

## Output Artifacts

Current output storage locations:

- `results/transcriptions`: managed transcript, summary, translation, and original transcript files
- `server/temp/latest-result.json`: latest run snapshot used by the UI
- `server/temp/history/*`: per-run history snapshots used for reopening past results

Related state in the same area:

- `server/temp/history-index.json`: compact index for the history list

## Notes For Maintainers

- `server/routes/asyncTranscription.js` exists, but it is not mounted in `server/index.js`, so it is not part of the active web app flow.
- The main flow is effectively single-file transcription today. `getAudioFiles()` currently returns the input file as a one-item array, while multi-file serial transcription remains reserved code for a future slicing workflow rather than the current default path.
