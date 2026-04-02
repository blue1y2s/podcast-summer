#!/usr/bin/env python3
"""
Fun-ASR recorded-file transcription with optional speaker diarization.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


def http_json(url, method="GET", headers=None, payload=None):
    request = urllib.request.Request(url, data=payload, headers=headers or {}, method=method)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_sentence(sentence):
    text = str(sentence.get("text") or "").strip()
    if not text:
        return None

    speaker_id = sentence.get("speaker_id")
    speaker = f"Speaker {int(speaker_id) + 1}" if speaker_id is not None else None
    return {
        "start": round((sentence.get("begin_time") or 0) / 1000, 2),
        "end": round((sentence.get("end_time") or 0) / 1000, 2),
        "speaker": speaker,
        "speaker_id": speaker_id,
        "text": text,
    }


def extract_result_payload(transcription_result):
    transcripts = transcription_result.get("transcripts") or []
    primary = transcripts[0] if transcripts else {}
    sentences = [normalize_sentence(item) for item in primary.get("sentences") or []]
    sentences = [item for item in sentences if item]

    return {
        "text": str(primary.get("text") or "").strip(),
        "segments": sentences,
        "duration": round((transcription_result.get("properties") or {}).get("original_duration_in_milliseconds", 0) / 1000, 2) or None,
    }


def main():
    parser = argparse.ArgumentParser(description="Fun-ASR 录音文件识别 + 说话人分离")
    parser.add_argument("--file-url", required=True, help="公网可访问的音频 URL")
    parser.add_argument("--model", default=os.environ.get("FUN_ASR_FILE_MODEL", "fun-asr"), help="Fun-ASR 文件模型名")
    parser.add_argument(
        "--api-root",
        default=os.environ.get("DASHSCOPE_API_ROOT", "https://dashscope.aliyuncs.com"),
        help="DashScope API 根地址",
    )
    parser.add_argument("--speaker-count", type=int, help="说话人数提示")
    parser.add_argument("--poll-interval", type=float, default=1.0, help="轮询间隔（秒）")
    parser.add_argument("--poll-timeout", type=int, default=1800, help="轮询超时（秒）")
    args = parser.parse_args()

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print(json.dumps({"success": False, "error": "缺少 DASHSCOPE_API_KEY"}, ensure_ascii=False))
        sys.exit(1)

    api_root = args.api_root.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    submission_payload = {
        "model": args.model,
        "input": {
            "file_urls": [args.file_url],
        },
        "parameters": {
            "channel_id": [0],
            "diarization_enabled": True,
        },
    }
    if args.speaker_count:
        submission_payload["parameters"]["speaker_count"] = args.speaker_count

    try:
        submit_result = http_json(
            f"{api_root}/api/v1/services/audio/asr/transcription",
            method="POST",
            headers=headers,
            payload=json.dumps(submission_payload).encode("utf-8"),
        )
        task_id = ((submit_result.get("output") or {}).get("task_id"))
        if not task_id:
            raise RuntimeError(f"任务提交失败: {submit_result}")

        deadline = time.time() + args.poll_timeout
        task_result = None
        while time.time() < deadline:
            task_result = http_json(
                f"{api_root}/api/v1/tasks/{task_id}",
                method="POST",
                headers=headers,
            )
            output = task_result.get("output") or {}
            status = output.get("task_status")

            if status == "SUCCEEDED":
                results = output.get("results") or []
                first_result = results[0] if results else None
                if not first_result:
                    raise RuntimeError(f"任务成功但无结果: {task_result}")
                if first_result.get("subtask_status") != "SUCCEEDED":
                    raise RuntimeError(first_result.get("message") or f"子任务失败: {first_result}")

                transcription_url = first_result.get("transcription_url")
                if not transcription_url:
                    raise RuntimeError(f"缺少 transcription_url: {task_result}")

                transcription_result = http_json(transcription_url, method="GET")
                payload = extract_result_payload(transcription_result)
                print(
                    json.dumps(
                        {
                            "success": True,
                            "task_id": task_id,
                            "request_id": task_result.get("request_id"),
                            "status": status,
                            "text": payload["text"],
                            "segments": payload["segments"],
                            "duration": payload["duration"],
                            "speaker_mode": "diarized",
                            "timing_mode": "provided",
                            "file_url": args.file_url,
                            "model": args.model,
                        },
                        ensure_ascii=False,
                    )
                )
                return

            if status not in {"RUNNING", "PENDING"}:
                raise RuntimeError(f"任务失败: {task_result}")

            time.sleep(args.poll_interval)

        raise TimeoutError(f"轮询超时，task_id={task_id}")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        print(json.dumps({"success": False, "error": body or str(error)}, ensure_ascii=False))
        sys.exit(1)
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
