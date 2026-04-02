# 后端处理链路

**[English](backend-pipeline.md)**

这份文档描述的是仓库当前已经实现并实际生效的后端行为，只基于现有代码，不写推测，也不讨论未来方案。

## Overview

Podcast Summer 目前支持两种输入模式：

- URL 模式：前端把播客链接或音频链接发到 `POST /api/process-podcast`
- 本地文件模式：前端先把音频上传到 `POST /api/upload-audio`，再调用 `POST /api/process-local-file`

两种模式都会通过 `GET /api/progress/:sessionId` 建立 SSE 连接，让服务端持续把进度推回前端。

两种模式的实际区别是：

- URL 模式可以解析播客页面、RSS 和直链音频，并且可以把公网直链音频继续传给 `fun_asr_file_diarization`
- 本地文件模式处理的是上传后的临时文件，不能使用 `fun_asr_file_diarization`，因为这个 backend 需要公网可访问的音频直链

## End-to-End Pipeline

### 1. 前端请求入口

- URL 模式调用 `POST /api/process-podcast`
- 本地文件模式先调用 `POST /api/upload-audio`
- 上传成功后再调用 `POST /api/process-local-file`
- 前端通过下面这些接口读取最近结果和历史记录：
  - `GET /api/latest-result`
  - `GET /api/history`
  - `GET /api/history/:historyId`
  - `DELETE /api/history/:historyId`

### 2. URL 解析或文件上传

URL 模式下，服务端会先把输入解析成可直接转录的音频源：

- 直接音频链接会直接使用
- Apple Podcasts 走 `iTunes API -> RSS -> enclosure`
- 小宇宙优先尝试页面元数据，再退到 RSS
- 通用播客页面会尝试 RSS 发现、HTML 抽取和直接音频模式匹配

URL 模式会明确拒绝 YouTube 和 Bilibili 视频页。当前建议是改用 RSS、音频直链，或者先把导出的音频文件上传。

本地文件模式下，上传文件会先落到 `server/temp`，然后进入同一套转录管线。

### 3. 音频下载与时长估算

URL 模式下，一旦拿到真实音频 URL，服务端会把音频下载到 `server/temp`。

在下载前后，服务端会基于文件大小估算时长。这个估算主要用于前端进度展示，不参与 backend 选择。

### 4. ASR 选择与执行

主转录入口是 `processAudioWithOpenAI(...)`。它会先规范化 `asrBackend`，然后：

- 如果指定了具体 backend，就直接执行该 backend
- 如果是 `auto`，就按固定顺序尝试当前可用 backend

当前 `auto` 顺序：

```text
fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local
```

执行前会先检查可用性。典型条件包括：

- DashScope 相关 backend 需要 `DASHSCOPE_API_KEY`
- `gemini_audio` 需要 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`
- `whisperx_local` 需要 Python 环境，以及 `PYANNOTE_TOKEN` 或等价的 Hugging Face token
- `fun_asr_file_diarization` 还额外要求 `sourceAudioUrl`，这意味着它本质上只适用于 URL 模式

### 5. 转录后处理

原始 ASR 结束后，会进入统一的 transcript 收尾阶段。

如果 ASR backend **没有**提供原生说话人分离：

- transcript 可能会先做一次可读性优化
- 再做文本级的说话人轮次细化
- 最后把说话人标签尽量统一成通用标签

如果 ASR backend **提供了**原生说话人分离：

- 会保留结构化的 speaker 和 timing 分段
- 跳过文本级说话人推断
- 只在 transcript 本身存在明确证据时，尝试把 `Speaker 1` 这种通用标签映射成真实姓名

### 6. 总结与翻译

如果操作类型是 `transcribe_summarize`，系统会基于最终 transcript 生成 summary。

只有当识别出的 transcript 语言和请求的 `outputLanguage` 不一致时，才会生成 translation。

也就是说：

- transcript 一定会有
- summary 取决于操作类型
- translation 取决于语言是否不一致

### 7. 结果保存与历史记录

最终结果文件会统一写入 `results/transcriptions`。

一次运行可能包含这些文件类型：

- `transcript`
- `original_transcript`
- `summary`
- `translation`

服务端还会额外保存：

- 最近一次结果快照
- 每次运行的历史快照
- 给前端历史列表使用的轻量索引

## Backend Matrix

| Backend | 作用 | 适合场景 | 关键限制 |
| --- | --- | --- | --- |
| `auto` | 按固定顺序自动尝试可用 backend | 默认模式，适合大多数用户 | 行为取决于当前环境和已配置的 key |
| `fun_asr_file_diarization` | DashScope 录音文件识别，提供原生说话人分离和时间轴 | 播客直链音频，且确实需要真实说话人分离 | 需要 `DASHSCOPE_API_KEY` 和公网音频直链 |
| `qwen3_asr` | 通过 Python 包装的 DashScope Qwen3-ASR，长音频会先做 VAD 分段 | 有 DashScope 环境的长音频转录 | 需要 Python 和 `DASHSCOPE_API_KEY`，没有原生说话人分离 |
| `gemini_audio` | Gemini 文件上传后做音频转录 | Web-first 使用方式里准备成本最低 | 需要 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`，没有原生说话人分离 |
| `fun_asr_realtime` | DashScope 实时识别风格转录，输入前会先转成 WAV | 需要 DashScope 转录，但不要求说话人分离 | 需要 Python 和 `DASHSCOPE_API_KEY`，没有原生说话人分离 |
| `whisperx_local` | 本地 WhisperX + pyannote，提供对齐时间轴和真实说话人分离 | 本地文件场景下确实需要 speaker diarization | 需要 Python、本地依赖和 `PYANNOTE_TOKEN` |
| `whisper_local` | 本地 faster-whisper 转录 | 最简单的本地兜底方案 | 需要 Python 和本地 Whisper 依赖，没有原生说话人分离 |

## Constraints And Fallbacks

- `whisper_local`、`whisperx_local`、`qwen3_asr`、`fun_asr_realtime`、`fun_asr_file_diarization` 都需要 Python。
- `fun_asr_file_diarization` 需要公网可访问的音频直链，所以本质上只适用于 URL 模式。
- 当前真正提供真实说话人分离的 backend 是 `fun_asr_file_diarization` 和 `whisperx_local`。
- `auto` 会严格按上面的固定顺序回退，并在遇到第一个“可用且执行成功”的 backend 时停止。
- URL 模式不支持 YouTube 和 Bilibili 视频页。
- 即使 ASR 本身来自本地或 DashScope，文本后处理和 summary 生成仍然依赖 AI 文本客户端。

## Output Artifacts

当前输出相关的主要目录和文件：

- `results/transcriptions`：统一管理的 transcript、summary、translation、original transcript 文件
- `server/temp/latest-result.json`：给前端读取最近结果用的快照
- `server/temp/history/*`：每次运行对应的历史快照

同一块状态里还有一个相关文件：

- `server/temp/history-index.json`：给历史记录列表使用的轻量索引

## Notes For Maintainers

- `server/routes/asyncTranscription.js` 这个异步转录路由文件目前存在，但没有在 `server/index.js` 里挂载，所以不属于当前 Web 主流程。
- 当前主流程本质上还是单文件转录。`getAudioFiles()` 现在只会把输入文件包装成一个单元素数组；多文件串行转录逻辑更像是给未来切片工作流预留的能力，不是当前默认路径。
