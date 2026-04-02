#!/usr/bin/env python3
"""
Local WhisperX + pyannote transcription with true speaker diarization.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path


def eprint(message):
    print(message, file=sys.stderr)


def normalize_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def join_segment_text(left, right):
    if not left:
        return right
    if not right:
        return left

    if re.search(r"[\u4e00-\u9fff，。！？、；：]$", left) or re.match(r"^[，。！？、；：]", right):
        return f"{left}{right}"

    return f"{left} {right}".strip()


def normalize_segment(segment):
    start = segment.get("start")
    end = segment.get("end")
    speaker = str(segment.get("speaker") or "").strip() or None
    text = normalize_text(segment.get("text"))

    if not text:
        return None

    return {
        "start": round(float(start), 2) if start is not None else None,
        "end": round(float(end), 2) if end is not None else None,
        "speaker": speaker,
        "text": text,
    }


def compact_segments(segments, max_gap_sec=1.0):
    compacted = []

    for raw_segment in segments:
        segment = normalize_segment(raw_segment)
        if not segment:
            continue

        previous = compacted[-1] if compacted else None
        gap_sec = None
        if previous and previous["end"] is not None and segment["start"] is not None:
            gap_sec = segment["start"] - previous["end"]

        if (
            previous
            and previous["speaker"] == segment["speaker"]
            and gap_sec is not None
            and gap_sec <= max_gap_sec
        ):
            previous["text"] = join_segment_text(previous["text"], segment["text"])
            previous["end"] = segment["end"] if segment["end"] is not None else previous["end"]
            continue

        compacted.append(segment)

    return compacted


class WhisperXDiarizationTranscriber:
    def __init__(
        self,
        model_name,
        device="cpu",
        compute_type="int8",
        model_dir=None,
        align_model_name=None,
        diarization_model_name="pyannote/speaker-diarization-community-1",
        hf_token=None,
        batch_size=8,
        local_files_only=False,
        threads=4,
    ):
        try:
            import whisperx
            from whisperx.audio import SAMPLE_RATE
            from whisperx.diarize import DiarizationPipeline, assign_word_speakers
        except ImportError as error:
            raise RuntimeError(
                "缺少 whisperx / pyannote 依赖，请先在 venv 中安装 `whisperx` 和 `pyannote.audio`"
            ) from error

        self.whisperx = whisperx
        self.sample_rate = SAMPLE_RATE
        self.DiarizationPipeline = DiarizationPipeline
        self.assign_word_speakers = assign_word_speakers
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.model_dir = model_dir
        self.align_model_name = align_model_name
        self.diarization_model_name = diarization_model_name
        self.hf_token = hf_token
        self.batch_size = batch_size
        self.local_files_only = local_files_only
        self.threads = threads

        if not self.hf_token:
            raise RuntimeError(
                "缺少 Hugging Face / pyannote token。请设置 PYANNOTE_TOKEN、HF_TOKEN 或 HUGGINGFACE_TOKEN。"
            )

    def transcribe_file(self, audio_path, language=None, prompt=None, min_speakers=None, max_speakers=None):
        started_at = time.time()
        audio_path = str(Path(audio_path).resolve())

        eprint(f"🔄 加载 WhisperX 模型: {self.model_name}")
        asr_model = self.whisperx.load_model(
            self.model_name,
            self.device,
            compute_type=self.compute_type,
            language=language,
            download_root=self.model_dir,
            local_files_only=self.local_files_only,
            threads=self.threads,
            vad_method="silero",
            vad_options={"chunk_size": 30, "vad_onset": 0.5, "vad_offset": 0.363},
            asr_options={"initial_prompt": prompt} if prompt else None,
        )

        eprint(f"🎤 WhisperX 转录: {audio_path}")
        audio = self.whisperx.load_audio(audio_path)
        result = asr_model.transcribe(audio, batch_size=self.batch_size, chunk_size=30)
        language_code = result.get("language") or language
        alignment_used = False

        del asr_model

        if result.get("segments"):
            try:
                eprint(f"🧭 加载对齐模型: {language_code}")
                align_model, align_metadata = self.whisperx.load_align_model(
                    language_code,
                    self.device,
                    model_name=self.align_model_name,
                    model_dir=self.model_dir,
                    model_cache_only=self.local_files_only,
                )
                result = self.whisperx.align(
                    result["segments"],
                    align_model,
                    align_metadata,
                    audio,
                    self.device,
                    return_char_alignments=False,
                )
                alignment_used = True
            except Exception as error:
                eprint(f"⚠️ 对齐失败，继续使用 ASR 原始时间轴: {error}")

        eprint(f"🗣️ 加载 diarization 模型: {self.diarization_model_name}")
        diarization_pipeline = self.DiarizationPipeline(
            model_name=self.diarization_model_name,
            token=self.hf_token,
            device=self.device,
            cache_dir=self.model_dir,
        )
        diarize_segments = diarization_pipeline(
            audio_path,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )
        result = self.assign_word_speakers(diarize_segments, result, fill_nearest=True)

        compacted_segments = compact_segments(result.get("segments", []))
        transcript_text = "\n\n".join(segment["text"] for segment in compacted_segments if segment["text"])
        duration = round(len(audio) / self.sample_rate, 2) if audio is not None else None
        speakers = sorted({segment["speaker"] for segment in compacted_segments if segment.get("speaker")})

        return {
            "success": True,
            "file": audio_path,
            "text": transcript_text,
            "segments": compacted_segments,
            "language": language_code,
            "duration": duration,
            "processing_time": round(time.time() - started_at, 2),
            "alignment_used": alignment_used,
            "speaker_count": len(speakers),
            "speaker_ids": speakers,
            "speaker_mode": "diarized",
            "timing_mode": "aligned" if alignment_used else "asr",
        }


def main():
    parser = argparse.ArgumentParser(description="WhisperX + pyannote 本地说话人分离转录")
    parser.add_argument("file", help="音频文件路径")
    parser.add_argument("--model", default="medium", help="Whisper / faster-whisper 模型名或本地目录")
    parser.add_argument("--language", help="指定语言代码，如 zh / en")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="计算设备")
    parser.add_argument(
        "--compute-type",
        default="int8",
        choices=["int8", "int16", "float16", "float32", "default"],
        help="计算精度",
    )
    parser.add_argument("--prompt", help="转录提示词/术语上下文")
    parser.add_argument("--model-dir", help="WhisperX / pyannote / 对齐模型缓存目录")
    parser.add_argument("--align-model", help="可选：显式指定对齐模型")
    parser.add_argument(
        "--diarization-model",
        default="pyannote/speaker-diarization-community-1",
        help="pyannote speaker diarization 模型名",
    )
    parser.add_argument("--hf-token", help="Hugging Face / pyannote token")
    parser.add_argument("--batch-size", type=int, default=8, help="WhisperX batch size")
    parser.add_argument("--threads", type=int, default=4, help="CPU threads for faster-whisper")
    parser.add_argument("--min-speakers", type=int, help="已知最少说话人数")
    parser.add_argument("--max-speakers", type=int, help="已知最多说话人数")
    parser.add_argument(
        "--local-files-only",
        action="store_true",
        help="只从本地缓存加载模型，不访问网络",
    )
    args = parser.parse_args()

    audio_path = Path(args.file)
    if not audio_path.exists():
        print(
            json.dumps(
                {
                    "success": False,
                    "error": f"文件不存在: {audio_path}",
                    "text": "",
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    hf_token = (
        args.hf_token
        or os.getenv("PYANNOTE_TOKEN")
        or os.getenv("HF_TOKEN")
        or os.getenv("HUGGINGFACE_TOKEN")
        or os.getenv("HUGGING_FACE_HUB_TOKEN")
    )

    try:
        transcriber = WhisperXDiarizationTranscriber(
            model_name=args.model,
            device=args.device,
            compute_type=args.compute_type.replace("-", "_"),
            model_dir=args.model_dir,
            align_model_name=args.align_model,
            diarization_model_name=args.diarization_model,
            hf_token=hf_token,
            batch_size=args.batch_size,
            local_files_only=args.local_files_only,
            threads=args.threads,
        )
        result = transcriber.transcribe_file(
            str(audio_path),
            language=args.language,
            prompt=args.prompt,
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
        )
    except Exception as error:
        result = {
            "success": False,
            "file": str(audio_path.resolve()),
            "error": str(error),
            "text": "",
        }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
