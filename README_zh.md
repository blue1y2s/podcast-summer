# Podcast Summer

以 Web 为主的播客转录与总结工具。

**中文 | [English](README.md)**

![Podcast Summer 截图](public/screenshot_zh.png)

## 简介

Podcast Summer 可以把播客链接或本地音频处理成 transcript、summary，以及按需生成的 translation。

当前主路径是 Web 应用。Electron 仍然保留，但只是遗留壳层，不是主动维护的主要界面。

## 快速开始

```bash
git clone https://github.com/blue1y2s/podcast-summer.git
cd podcast-summer
npm install
cp .env.example .env
# 在 .env 里填写 GEMINI_API_KEY
npm start
```

访问服务端打印出来的地址，通常是 `http://localhost:3000`。

如果你想用最短路径先跑起来，直接从 `gemini_audio` 开始。

## 处理流程概览

1. 输入播客链接，或上传本地音频文件。
2. 服务端解析链接或接收上传的音频。
3. 所选 ASR backend 生成原始 transcript。
4. 转录后处理流程负责整理格式、细化说话人轮次、生成 summary，以及按需生成 translation。
5. 输出文件写入 `results/transcriptions`，本地历史快照保存在 `server/temp`。

完整链路和后端差异见 [docs/backend-pipeline.zh.md](docs/backend-pipeline.zh.md)。

## ASR 后端概览

支持的 ASR backend：

- `auto`：按固定回退顺序自动尝试当前可用后端。
- `fun_asr_file_diarization`：DashScope 录音文件识别，适合公网直链音频，并提供原生说话人分离。
- `qwen3_asr`：DashScope Qwen3-ASR，长音频会先做 VAD 分段。
- `gemini_audio`：Gemini 音频转录，准备成本最低。
- `fun_asr_realtime`：DashScope Fun-ASR 实时识别，可处理下载后的音频或上传文件。
- `whisperx_local`：本地 WhisperX + pyannote，提供真实说话人分离。
- `whisper_local`：本地 faster-whisper，适合作为最简单的本地兜底方案。

当前 `auto` 顺序：

```text
fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local
```

只有下面这些 backend 需要 Python：

- `whisper_local`
- `whisperx_local`
- `qwen3_asr`
- `fun_asr_realtime`
- `fun_asr_file_diarization`

更细的限制、依赖和适用场景见 [docs/backend-pipeline.zh.md](docs/backend-pipeline.zh.md)。

## 输出与历史记录

- 导出的文本文件：`results/transcriptions`
- 最近一次结果快照：`server/temp/latest-result.json`
- 本地历史快照：`server/temp/history`

当前实现也提供了历史记录接口，用于重新打开和删除已有运行结果。

## 详细文档

- [中文详细说明](docs/backend-pipeline.zh.md)
- [Backend pipeline details](docs/backend-pipeline.md)

## 常用命令

```bash
npm start
npm run dev
npm run ui:dev
npm run ui:build
npm run ui:preview
npm test
npm run check
```

`npm test` 会对 Express 应用运行一轮无需密钥的 smoke check。`npm run check` 会先重新构建 UI，再执行这轮 smoke check。

`npm run desktop` 还在，但现在只是遗留包装层。

## 致谢

这个仓库最初来自 [wendy7756/podcast-transcriber](https://github.com/wendy7756/podcast-transcriber)，现在已经按 Web-first 的方向继续整理和开发。

## 许可证

Apache 2.0，见 [LICENSE](LICENSE)。
