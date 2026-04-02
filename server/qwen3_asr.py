#!/usr/bin/env python3
"""
Qwen3-ASR wrapper returning structured JSON for the Node backend.
"""

import argparse
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path

import dashscope
from silero_vad import load_silero_vad

from qwen3_asr_toolkit.audio_tools import (
    WAV_SAMPLE_RATE,
    load_audio,
    process_vad,
    save_audio_file,
)
from qwen3_asr_toolkit.qwen3asr import QwenASR


def build_segments(wav_chunks, texts):
    segments = []
    for index, ((start_sample, end_sample, _wav), text) in enumerate(zip(wav_chunks, texts), start=1):
        cleaned = str(text or "").strip()
        if not cleaned:
            continue
        segments.append(
            {
                "id": f"segment_{index}",
                "start": round(start_sample / WAV_SAMPLE_RATE, 2),
                "end": round(end_sample / WAV_SAMPLE_RATE, 2),
                "text": cleaned,
            }
        )
    return segments


def main():
    parser = argparse.ArgumentParser(description="Qwen3-ASR 本地包装脚本")
    parser.add_argument("file", help="输入音频文件路径")
    parser.add_argument("--model", default=os.environ.get("QWEN3_ASR_MODEL", "qwen3-asr-flash"), help="Qwen3-ASR 模型名")
    parser.add_argument("--context", default="", help="转录上下文")
    parser.add_argument("--tmp-dir", default=os.path.join(os.path.expanduser("~"), "qwen3-asr-cache"), help="临时目录")
    parser.add_argument("--num-threads", type=int, default=4, help="并发线程数")
    parser.add_argument("--vad-segment-threshold", type=int, default=120, help="VAD 分段阈值（秒）")
    parser.add_argument("--silence", action="store_true", help="减少 stderr 输出")
    args = parser.parse_args()

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print(json.dumps({"success": False, "error": "缺少 DASHSCOPE_API_KEY"}, ensure_ascii=False))
        sys.exit(1)

    input_path = Path(args.file)
    if not input_path.exists():
        print(json.dumps({"success": False, "error": f"文件不存在: {input_path}"}, ensure_ascii=False))
        sys.exit(1)

    dashscope.api_key = api_key
    save_dir = None

    try:
        wav = load_audio(str(input_path))
        duration = round(len(wav) / WAV_SAMPLE_RATE, 2)

        if duration >= 180:
            if not args.silence:
                print("Initializing Silero VAD for long audio...", file=sys.stderr)
            vad_model = load_silero_vad(onnx=True)
            wav_chunks = process_vad(wav, vad_model, segment_threshold_s=args.vad_segment_threshold)
        else:
            wav_chunks = [(0, len(wav), wav)]

        save_dir = os.path.join(args.tmp_dir, input_path.stem)
        wav_paths = []
        for idx, (_start, _end, wav_data) in enumerate(wav_chunks):
            wav_path = os.path.join(save_dir, f"{input_path.stem}_{idx}.wav")
            save_audio_file(wav_data, wav_path)
            wav_paths.append(wav_path)

        asr = QwenASR(model=args.model)
        results = []
        languages = []
        for idx, wav_path in enumerate(wav_paths):
            language, text = asr.asr(wav_path, args.context)
            results.append((idx, text))
            languages.append(language)

        results.sort(key=lambda item: item[0])
        texts = [text for _idx, text in results]
        full_text = " ".join(texts).strip()
        language = Counter(languages).most_common(1)[0][0] if languages else None

        print(
            json.dumps(
                {
                    "success": True,
                    "file": str(input_path.resolve()),
                    "text": full_text,
                    "language": language,
                    "duration": duration,
                    "segments": build_segments(wav_chunks, texts),
                    "model": args.model,
                },
                ensure_ascii=False,
            )
        )
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error), "text": ""}, ensure_ascii=False))
        sys.exit(1)
    finally:
        if save_dir and os.path.exists(save_dir):
            shutil.rmtree(save_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
