#!/bin/bash

echo "🎙️ Podcast Summer 快速启动脚本"
echo "================================"

# 检查Node.js环境
echo "📋 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装或未在PATH中"
    echo "请安装Node.js: https://nodejs.org/"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装或未在PATH中"
    exit 1
fi

echo "✅ Node.js: $(node -v)"
echo "✅ npm: $(npm -v)"

# 检查是否在正确目录
if [ ! -f "package.json" ]; then
    echo "❌ 请在项目根目录运行此脚本"
    echo "当前目录: $(pwd)"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 检查端口占用
PORT=3000
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "⚠️ 端口 $PORT 被占用，自动选择其他端口..."
fi

# 启动服务器
echo "🚀 构建并启动 Podcast Summer..."
echo "🌐 服务启动后访问日志里打印的地址（通常是 http://localhost:3000）"
echo "🛑 按 Ctrl+C 停止服务器"
echo "================================"

npm start
