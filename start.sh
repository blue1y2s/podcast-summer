#!/bin/bash

# 🎙️ Podcast提取器启动脚本 / Podcast Transcriber Startup Script

echo "🎙️ 启动Podcast提取器... / Starting Podcast Transcriber..."

# 检查Node.js是否已安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js 16+ / Node.js not found, please install Node.js 16+"
    exit 1
fi

# 检查是否存在.env文件
if [ ! -f .env ]; then
    echo "⚠️  .env文件不存在，正在创建... / .env file not found, creating..."
    cat > .env << EOL
# Gemini / OpenAI兼容配置（用于 Gemini Audio、总结和翻译）
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/

# Qwen3-ASR Toolkit 配置（用于 Qwen 云端转录）
DASHSCOPE_API_KEY=your_dashscope_api_key_here
QWEN_ASR_COMMAND=qwen3-asr

# 本地 Whisper 配置（离线/兜底）
WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# 服务器配置 / Server Configuration
PORT=3000

# 支持的最大文件大小 (MB) / Max file size (MB)
MAX_FILE_SIZE=50
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
echo "🚀 启动服务器... / Starting server..."
echo "🌐 访问地址 / Access URL: http://localhost:3000"
echo "🛑 按 Ctrl+C 停止服务器 / Press Ctrl+C to stop server"
echo "🧠 可选 ASR 后端 / Available ASR backends: auto, qwen_asr, gemini_audio, whisper_local"

npm start
