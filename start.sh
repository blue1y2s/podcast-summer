#!/bin/bash

# 🎙️ Podcast Summer 启动脚本 / Podcast Summer Startup Script

echo "🎙️ 启动 Podcast Summer... / Starting Podcast Summer..."

# 检查Node.js是否已安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js 16+ / Node.js not found, please install Node.js 16+"
    exit 1
fi

# 检查是否存在.env文件
if [ ! -f .env ]; then
    echo "⚠️  .env文件不存在，正在创建... / .env file not found, creating..."
    cat > .env << EOL
# Gemini / OpenAI-compatible configuration (used for Gemini Audio, summary, translation)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_TRANSCRIBE_MODEL=gemini-3.1-flash-lite-preview
GEMINI_TRANSCRIBE_FALLBACK_MODELS=gemini-2.5-flash
GEMINI_FAST_MODEL=gemini-3.1-flash-lite-preview
GEMINI_MODEL=gemini-3.1-flash-lite-preview
GEMINI_SUMMARY_MODEL=gemini-3.1-pro-preview

# DashScope ASR configuration
DASHSCOPE_API_KEY=your_dashscope_api_key_here
DASHSCOPE_API_ROOT=https://dashscope.aliyuncs.com
QWEN3_ASR_MODEL=qwen3-asr-flash
FUN_ASR_REALTIME_MODEL=fun-asr-realtime-2026-02-28
FUN_ASR_FILE_MODEL=fun-asr

# Local Whisper configuration (offline / fallback)
WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# WhisperX + pyannote configuration (true speaker diarization)
WHISPERX_MODEL=./models/faster-whisper-large-v3
WHISPERX_DEVICE=cpu
WHISPERX_COMPUTE_TYPE=int8
WHISPERX_MODEL_DIR=./models
PYANNOTE_TOKEN=your_huggingface_or_pyannote_token_here
PYANNOTE_DIARIZATION_MODEL=pyannote/speaker-diarization-community-1
# Optional
# WHISPER_PYTHON_BIN=./venv/bin/python

# Server configuration
PORT=3000

# Optional: legacy audio processing limits
MAX_SEGMENT_SIZE_MB=25
SEGMENT_DURATION_SECONDS=600
EOL
    echo "📝 请编辑 .env 文件，至少配置一种可用 ASR 后端 / Please edit .env and configure at least one ASR backend"
    echo "📖 Gemini API Key: https://aistudio.google.com/app/apikey"
    echo "📖 DashScope API Key: https://dashscope.console.aliyun.com/"
    exit 1
fi

# 检查是否安装了依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖... / Installing dependencies..."
    npm install
fi

# 启动服务器
echo "🚀 构建并启动应用... / Building UI and starting server..."
echo "🌐 访问地址 / Access URL: check the URL printed by the server (usually http://localhost:3000)"
echo "🛑 按 Ctrl+C 停止服务器 / Press Ctrl+C to stop server"
echo "🧠 可选 ASR 后端 / Available ASR backends: auto, fun_asr_file_diarization, qwen3_asr, gemini_audio, fun_asr_realtime, whisperx_local, whisper_local"

npm start
