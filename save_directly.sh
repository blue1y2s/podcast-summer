#!/bin/bash

echo "🎯 直接本地转录，不使用API"

# 查找音频文件
AUDIO_FILE=$(find server/temp -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" | head -1)

if [ -z "$AUDIO_FILE" ]; then
    echo "❌ 未找到音频文件"
    exit 1
fi

echo "🎵 音频文件: $(basename "$AUDIO_FILE")"

# 创建输出文件名
TIMESTAMP=$(date +%s)
OUTPUT_FILE="server/temp/podcast_${TIMESTAMP}_transcript.txt"

echo "📝 开始转录..."

# 直接运行Python脚本并提取文本
WHISPER_MODEL="${WHISPER_MODEL:-medium}"
python3 server/whisper_transcribe.py "$AUDIO_FILE" --model "$WHISPER_MODEL" | jq -r '.text' > "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
    echo "✅ 转录完成！"
    echo "📄 文件: $(basename "$OUTPUT_FILE")"
    echo "📊 大小: $(du -h "$OUTPUT_FILE" | cut -f1)"
    echo "📍 完整路径: $OUTPUT_FILE"
    echo ""
    echo "📝 内容预览："
    head -c 200 "$OUTPUT_FILE"
    echo "..."
else
    echo "❌ 转录失败"
    exit 1
fi
