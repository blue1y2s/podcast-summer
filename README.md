# Podcast Summer

Web-first podcast transcription and summarization.

English | [中文](README_zh.md)

![Podcast Transcriber Screenshot](public/screenshot_en.png)

## Overview

Podcast Summer is a web app for turning podcast links or uploaded audio into transcripts, summaries, and optional translations.

The main path is the web app. Electron is kept only as a legacy wrapper and is not actively maintained.

## Quick Start

```bash
git clone https://github.com/blue1y2s/podcast-summer.git
cd podcast-summer
npm install
cp .env.example .env
# set GEMINI_API_KEY in .env
npm start
```

Open `http://localhost:3000`.

If you only want the shortest setup, start with `gemini_audio`.

## Python Backends

You only need Python for these backends:

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

Install only what you need:

```bash
pip install faster-whisper
pip install whisperx pyannote.audio
pip install dashscope silero-vad qwen3-asr-toolkit
```

Install `ffmpeg` if you use local transcription or audio conversion.

## Backends

Supported ASR backends:

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

- `fun_asr_file_diarization` only works with a public direct audio URL
- `whisperx_local` needs `PYANNOTE_TOKEN`

## Commands

```bash
npm start
npm run dev
npm run ui:dev
npm run ui:build
npm run ui:preview
```

`npm run desktop` still exists, but it is legacy packaging.

## Output

- exported files: `results/transcriptions`
- local history: `server/temp`

## Attribution

This repository started from [wendy7756/podcast-transcriber](https://github.com/wendy7756/podcast-transcriber) and has since been reshaped around a web-first workflow.

## License

Apache 2.0. See [LICENSE](LICENSE).
