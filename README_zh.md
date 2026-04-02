# Podcast Summer

以 Web 为主的播客转录与总结工具。

**中文 | [English](README.md)**

## 这个仓库现在是什么

这是一个正在使用的 Web 应用，用来把播客链接或本地音频处理成：

- transcript
- summary
- 按需 translation

这个项目的重点不是绑定某一家转录服务，而是保留选择空间。你可以按场景切换不同 ASR 路径：想要最省事的启动方式、想用云端能力、想要本地兜底，或者需要说话人分离，都可以走不同后端。

## 当前方向

- Web 端是主产品。
- Electron 现在只保留一个遗留壳层，不属于主动维护范围。
- 以后如果真的要做桌面 GUI，也应该从当前 Web 流程往外包装，而不是反过来以桌面端为主。

## 最快启动方式

如果你只是想先把 Web 跑起来，最短路径就是：

```bash
git clone https://github.com/blue1y2s/podcast-summer.git
cd podcast-summer
npm install
cp .env.example .env
```

在 `.env` 里填好 `GEMINI_API_KEY`，然后启动：

```bash
npm start
```

访问 `http://localhost:3000`。

这条路径足够你先用 `gemini_audio` 把整个 Web 应用跑起来。

## 什么时候需要 Python

只是启动 Web，不一定需要 Python。

只有在你要使用下面这些后端时，才需要额外准备 Python 环境：

- `whisper_local`
- `whisperx_local`
- `qwen3_asr`
- `fun_asr_realtime`
- `fun_asr_file_diarization`

最小准备方式：

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
```

然后按需安装，不要一股脑全装：

```bash
# whisper_local
pip install faster-whisper

# whisperx_local
pip install whisperx pyannote.audio

# qwen3_asr
pip install dashscope silero-vad qwen3-asr-toolkit

# fun_asr_realtime / fun_asr_file_diarization
pip install dashscope
```

如果你要做本地转录或者音频转码，请确认系统里有 `ffmpeg`。

## 支持的输入

- Apple Podcasts
- 小宇宙
- RSS feed
- 直接音频 URL
- 本地上传，例如 `mp3`、`m4a`、`wav`、`aac`、`ogg`、`flac`、`mp4`、`webm`

## 后端

目前支持的 ASR backend：

- `auto`
- `gemini_audio`
- `qwen3_asr`
- `fun_asr_realtime`
- `fun_asr_file_diarization`
- `whisper_local`
- `whisperx_local`

当前 `auto` 的尝试顺序：

```text
fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local
```

补充几点：

- `fun_asr_file_diarization` 只能处理公网可访问的直接音频 URL
- `whisperx_local` 需要 `PYANNOTE_TOKEN`
- 对 Web 版本来说，`gemini_audio` 依然是最容易启动的入口

## 常用命令

```bash
npm start          # 启动 Express 服务
npm run dev        # 用 nodemon 跑后端开发模式
npm run ui:dev     # 启动 Vite 前端开发服务，并把 /api 代理到 localhost:3000
npm run ui:build   # 把 React 前端构建到 dist/
npm run ui:preview # 预览构建结果
```

`npm run desktop` 还保留着，但现在只应该把它当成遗留包装层，不是主路径。

## 环境变量

从 `.env.example` 开始即可。

最重要的是这些：

- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`
- `DASHSCOPE_API_KEY`
- `QWEN3_ASR_MODEL`
- `FUN_ASR_REALTIME_MODEL`
- `FUN_ASR_FILE_MODEL`
- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- `WHISPERX_MODEL`
- `WHISPERX_MODEL_DIR`
- `PYANNOTE_TOKEN`
- `PORT`

## 输出位置

- 正式输出文件保存在 `results/transcriptions`
- 本地历史快照保存在 `server/temp`

## 目录结构

```text
src/        React Web 前端
server/     Express API 和后端集成
electron/   遗留桌面壳层
results/    导出结果
public/     静态资源
```

## 致谢

这个仓库最初来自 [wendy7756/podcast-transcriber](https://github.com/wendy7756/podcast-transcriber)，现在已经按 Web-first 的方向重新整理和继续开发。

## 许可证

Apache 2.0，见 [LICENSE](LICENSE)。
