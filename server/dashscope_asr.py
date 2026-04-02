#!/usr/bin/env python3
"""
DashScope Fun-ASR 实时识别转录脚本
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import dashscope
from dashscope.audio.asr.recognition import Recognition, RecognitionCallback


DEFAULT_MODEL = os.environ.get("DASHSCOPE_ASR_MODEL", "fun-asr-realtime-2026-02-28")


class SilentCallback(RecognitionCallback):
    pass


def convert_to_16k_wav(input_path: str) -> str:
    temp_fd, temp_path = tempfile.mkstemp(suffix=".wav", prefix="dashscope_asr_")
    os.close(temp_fd)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-ar",
                "16000",
                "-ac",
                "1",
                temp_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        return temp_path
    except subprocess.CalledProcessError as error:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise RuntimeError(error.stderr.strip() or "ffmpeg 转码失败") from error


def collect_text(result) -> str:
    sentences = []
    sentence_output = result.output.get("sentence", []) if getattr(result, "output", None) else []
    for item in sentence_output:
        text = str(item.get("text", "")).strip()
        if text:
            sentences.append(text)
    return " ".join(sentences).strip()


def main():
    parser = argparse.ArgumentParser(description="DashScope Fun-ASR 文件转录")
    parser.add_argument("file", help="输入音频文件")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="DashScope ASR 模型名")
    parser.add_argument("--language", help="语言提示，如 zh / en / ja")
    args = parser.parse_args()

    input_path = Path(args.file)
    if not input_path.exists():
        print(json.dumps({"success": False, "error": f"文件不存在: {input_path}"}, ensure_ascii=False))
        sys.exit(1)

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print(json.dumps({"success": False, "error": "缺少 DASHSCOPE_API_KEY"}, ensure_ascii=False))
        sys.exit(1)

    dashscope.api_key = api_key
    temp_wav_path = None

    try:
        temp_wav_path = convert_to_16k_wav(str(input_path))
        recognizer = Recognition(
            model=args.model,
            callback=SilentCallback(),
            format="wav",
            sample_rate=16000,
        )

        extra_kwargs = {}
        if args.language and args.language != "auto":
            extra_kwargs["language_hints"] = [args.language]

        result = recognizer.call(temp_wav_path, **extra_kwargs)
        transcript = collect_text(result)

        response = {
            "success": True,
            "text": transcript,
            "language": args.language if args.language and args.language != "auto" else None,
            "request_id": getattr(result, "request_id", None),
            "status_code": getattr(result, "status_code", None),
            "model": args.model,
        }
        print(json.dumps(response, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
    finally:
        if temp_wav_path and os.path.exists(temp_wav_path):
            os.unlink(temp_wav_path)


if __name__ == "__main__":
    main()
