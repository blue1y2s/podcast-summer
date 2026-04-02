# Podcast Summer

Web-first podcast transcription and summarization.

English | [中文](README_zh.md)

## What This Repo Is

This repository is a working web app for turning podcast links or uploaded audio into:

- transcript
- summary
- optional translation

The point of the project is flexibility, not a single fixed transcription provider. You can run different ASR paths depending on what you care about: shortest setup, cloud quality, local fallback, or speaker diarization.

## Current Direction

- The web app is the main product.
- The Electron shell is kept only as a legacy wrapper and is not actively maintained.
- If a desktop GUI becomes necessary later, it can be rebuilt from the web flow instead of driving the product now.

## Fastest Way To Run It

If you only want the web app working with the least setup:

```bash
git clone https://github.com/blue1y2s/podcast-summer.git
cd podcast-summer
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`, then start the server:

```bash
npm start
```

Open `http://localhost:3000`.

That path is enough to use the app with `gemini_audio`.

## When You Need Python

You do not need Python just to bring up the web UI.

You do need a Python environment if you want any of these backends:

- `whisper_local`
- `whisperx_local`
- `qwen3_asr`
- `fun_asr_realtime`
- `fun_asr_file_diarization`

Minimal setup:

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
```

Install only what you plan to use:

```bash
# whisper_local
pip install faster-whisper

# whisperx_local
pip install whisperx pyannote.audio

# qwen3_asr
pip install dashscope silero-vad qwen3-asr-toolkit

# fun_asr_realtime / fun_asr_file_diarization
pip install dashscope
```

Install `ffmpeg` if you use local transcription or audio conversion.

## Supported Inputs

- Apple Podcasts
- Xiaoyuzhou
- RSS feeds
- direct audio URLs
- local uploads such as `mp3`, `m4a`, `wav`, `aac`, `ogg`, `flac`, `mp4`, `webm`

## Backends

Available ASR backends:

- `auto`
- `gemini_audio`
- `qwen3_asr`
- `fun_asr_realtime`
- `fun_asr_file_diarization`
- `whisper_local`
- `whisperx_local`

Current `auto` order:

```text
fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local
```

Notes:

- `fun_asr_file_diarization` only works with a publicly reachable direct audio URL
- `whisperx_local` needs `PYANNOTE_TOKEN`
- `gemini_audio` is the easiest starting point for the web version

## Useful Commands

```bash
npm start          # start the Express server
npm run dev        # backend dev mode with nodemon
npm run ui:dev     # Vite UI dev server, proxies /api to localhost:3000
npm run ui:build   # build the React UI into dist/
npm run ui:preview # preview the built UI
```

`npm run desktop` still exists, but it should be treated as legacy packaging rather than the main app path.

## Environment

Start from `.env.example`.

The variables that matter most:

- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`
- `DASHSCOPE_API_KEY`
- `QWEN3_ASR_MODEL`
- `FUN_ASR_REALTIME_MODEL`
- `FUN_ASR_FILE_MODEL`
- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- `WHISPERX_MODEL`
- `WHISPERX_MODEL_DIR`
- `PYANNOTE_TOKEN`
- `PORT`

## Output

- managed output files are saved under `results/transcriptions`
- local history snapshots are stored under `server/temp`

## Layout

```text
src/        React web UI
server/     Express API and backend integrations
electron/   legacy desktop shell
results/    exported output files
public/     static assets
```

## Attribution

This repository started from [wendy7756/podcast-transcriber](https://github.com/wendy7756/podcast-transcriber) and has since been reshaped around a web-first workflow.

## License

Apache 2.0. See [LICENSE](LICENSE).
