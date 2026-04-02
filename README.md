<div align="center">
  
# 🎙️ AI Podcast Transcriber

English | [中文](README_zh.md)

An open-source tool that turns podcasts into high-quality transcripts and AI-powered summaries.

![Podcast Transcriber Interface](public/podcast_en.jpeg)

</div>

## 🌟 Project Overview

Podcast Transcriber is a full-stack web application designed to bridge the gap between audio content and text accessibility. It automatically processes podcast episodes from various platforms, and delivers accurate transcriptions with meaningful summaries in multiple languages.

## 📌 Project Status

- The web app is the primary and actively maintained interface for this project.
- The Electron desktop app is kept in the repository for reference, but it is not actively maintained for now.
- If there is clear demand later, the desktop GUI can be revisited. For local automation, a CLI or skill-based interface is the more likely next step.

### Key Capabilities

- **🔗 Multi-Platform Support**: Support for Apple Podcasts, Xiaoyuzhoufm, RSS feeds, and direct audio URLs
- **🎛️ Multi-Backend ASR**: Switch between `auto`, `fun_asr_file_diarization`, `qwen3_asr`, `gemini_audio`, `fun_asr_realtime`, `whisperx_local`, and `whisper_local`
- **🚀 Performance First**: Use cloud ASR for quality, WhisperX + pyannote for true diarization, or local Whisper for offline fallback
- **🤖 AI Optimization**: AI-optimized transcription and summary text based on podcast content characteristics
- **📱 Responsive Design**: Modern mobile-first UI, friendly experience for both desktop and mobile
- **🌍 Conditional Translation**: When the selected summary language differs from the detected transcript language, the system auto-translates with GPT‑4o
- **🧠 Hotwords & Context**: Pass proper nouns and disambiguation context from UI or API to improve mixed-language recognition

## 🏗️ Architecture & Implementation

### System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend       │    │  External APIs  │
│                 │    │                  │    │                 │
│ • HTML5/CSS3    │◄──►│ • Express.js     │◄──►│ • OpenAI GPT    │
│ • Vanilla JS    │    │ • Node.js        │    │ • RSS Feeds     │
│ • TailwindCSS   │    │ • File Download  │    │ • Podcast APIs  │
│ • File Download │    │ • Text Saving    │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Local Processing │
                    │                  │
                    │ • Faster-Whisper │
                    │ • Python Script  │
                    │ • Audio Direct   │
                    │ • Text Export    │
                    └──────────────────┘
```

### Core Processing Pipeline

1. **Podcast Link Analysis**: Multi-strategy URL parsing for Apple Podcasts, Xiaoyuzhou, and RSS feeds
2. **Audio Extraction**: Direct download with RSS feed discovery and API integration  
3. **ASR Selection**: Route audio to Qwen3-ASR, Gemini Audio, or local Faster-Whisper
4. **Text Optimization**: AI-powered continuity enhancement and flow improvement
5. **Summarization**: Structured content analysis and key point extraction
6. **File Export**: Automatic saving of transcripts and summaries with download links

### Technology Stack

#### Frontend Architecture
- **HTML5**: Semantic markup with accessibility features
- **TailwindCSS**: Utility-first styling with custom design system
- **Vanilla JavaScript**: Lightweight, dependency-free client-side logic
- **Progressive Enhancement**: Graceful degradation for various devices

#### Backend Infrastructure
- **Node.js**: Asynchronous, event-driven server runtime
- **Express.js**: Minimalist web framework with middleware support
- **Python Integration**: Calls Faster-Whisper for local transcription
- **File Management**: Audio download, processing, and result saving

#### AI & ML Integration
- **Qwen3-ASR Toolkit**: DashScope-backed long-audio transcription with built-in VAD chunking
- **Gemini Audio**: Direct audio understanding for cloud transcription
- **WhisperX + pyannote**: Local transcription with audio-level speaker diarization
- **Faster-Whisper**: Local high-performance offline fallback transcription
- **Gemini / OpenAI-compatible chat models**: Text optimization, speaker-turn refinement, summarization, and translation
- **Custom Prompting**: Specialized prompts optimized for podcasts, enhancing continuity and quality

## 📁 Project Structure

```
podcast-to-text/
├── 📂 public/                          # Frontend Application
│   ├── 📄 index.html                   # Main application interface
│   └── 📄 script.js                    # Client-side logic & UI interactions
│
├── 📂 server/                          # Backend Services
│   ├── 📄 index.js                     # Express server & API routing
│   ├── 📄 whisper_transcribe.py        # Local Faster-Whisper transcription
│   ├── 📂 assets/                      # Test assets
│   │   └── 📄 test_audio.mp3           # Sample audio for testing
│   ├── 📂 services/                    # Core business logic
│   │   ├── 📄 openaiService.js         # AI processing & optimization
│   │   ├── 📄 podcastService.js        # Podcast extraction & parsing
│   │   ├── 📄 audioInfoService.js        # Audio information retrieval
│   │   └── 📄 rssParser.js             # RSS feed processing
│   └── 📂 temp/                        # Temporary audio & text storage (auto-created)
│
├── 📄 package.json                     # Dependencies & scripts
├── 📄 package-lock.json                # Dependency lock file
├── 📄 .env                            # Environment configuration (create from .env.example)
├── 📄 .gitignore                       # Git ignore rules
├── 📄 README.md                        # English documentation
├── 📄 README_zh.md                     # Chinese documentation
├── 📄 PLATFORM_SUPPORT.md             # Platform compatibility guide
├── 📄 start.sh                        # Production start script
├── 📄 quick-start.sh                   # Quick setup script
└── 📄 fix-cursor-terminal.md           # IDE troubleshooting guide
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 16+**: Runtime environment
- **Python 3.8+**: For local Faster-Whisper transcription (virtual environment recommended)
- **ffmpeg**: Audio processing library (usually pre-installed or available via package managers)
- **At least one ASR backend**:
  - **DashScope API Key** for `qwen3_asr`, `fun_asr_realtime`, or `fun_asr_file_diarization`
  - **Gemini API Key** for `gemini_audio`
  - **Hugging Face / pyannote token** for `whisperx_local`
  - **Local Python + faster-whisper** for `whisper_local`

### Installation

```bash
# Clone the repository
git clone https://github.com/blue1y2s/podcast-summer.git
cd podcast-transcriber

# Install Node.js dependencies
npm install

# Create Python virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# or venv\Scripts\activate  # Windows

# Install Python dependencies (local whisper, WhisperX diarization, optional Qwen)
pip install --upgrade pip
pip install faster-whisper
pip install whisperx pyannote.audio
pip install qwen3-asr-toolkit

# Configure environment
cp .env.example .env
# Edit .env and configure at least one ASR backend

# Start the application
npm start
# or development mode (auto-reload)
npm run dev

# Access the application
open http://localhost:3000
```

### ⚠️ Important Notes

**Python Virtual Environment Setup**: The project requires a Python virtual environment named `venv` in the project root directory. This is essential because the Node.js server calls `./venv/bin/python` to execute transcription scripts.

If you encounter errors like `/bin/sh: .../venv/bin/python: No such file or directory`, please ensure:

1. Create the virtual environment in the project root: `python3 -m venv venv`
2. Activate the virtual environment: `source venv/bin/activate`
3. Install dependencies in the virtual environment: `pip install faster-whisper`

### Configuration

Create a `.env` file with the following variables:

```env
# Gemini / OpenAI-compatible configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/

# DashScope ASR
DASHSCOPE_API_KEY=your_dashscope_api_key_here
DASHSCOPE_API_ROOT=https://dashscope.aliyuncs.com
QWEN3_ASR_MODEL=qwen3-asr-flash
FUN_ASR_REALTIME_MODEL=fun-asr-realtime-2026-02-28
FUN_ASR_FILE_MODEL=fun-asr

# Local Whisper configuration
WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# WhisperX + pyannote configuration
WHISPERX_MODEL=./models/faster-whisper-large-v3
WHISPERX_MODEL_DIR=./models
PYANNOTE_TOKEN=your_huggingface_or_pyannote_token_here
PYANNOTE_DIARIZATION_MODEL=pyannote/speaker-diarization-community-1
# Optional
# WHISPER_PYTHON_BIN=./venv/bin/python

# Server Configuration
PORT=3000

# Optional: Audio processing configuration
MAX_SEGMENT_SIZE_MB=25
SEGMENT_DURATION_SECONDS=600
```

Notes:

- `auto` backend selection tries `fun_asr_file_diarization -> qwen3_asr -> gemini_audio -> fun_asr_realtime -> whisperx_local -> whisper_local`
- Explicit backend selection never silently switches providers
- `hotwords` and `transcriptionContext` can be set from the UI or passed directly to the API payload
- For GPU setups, `WHISPER_MODEL=large-v3` is recommended
- `whisperx_local` requires a Hugging Face / pyannote token and downloads alignment / diarization models on first use
- `fun_asr_file_diarization` requires a publicly accessible direct audio URL; it does not work for local uploads

## 🔧 Troubleshooting

### Common Issues

**Q: Getting `No such file or directory: .../venv/bin/python` error**

A: This indicates that the Python virtual environment is not properly created. Follow these steps:

```bash
# Ensure you're in the project root directory
cd /path/to/podcast-transcriber

# Remove any existing incorrect virtual environment
rm -rf venv

# Create a new virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Verify Python path
which python  # Should show .../venv/bin/python

# Install dependencies
pip install --upgrade pip
pip install faster-whisper

# Restart the server
npm start
```

**Q: Transcription function not responding or showing errors**

A: Ensure that:
1. Virtual environment is properly created and activated
2. `faster-whisper` is installed in the virtual environment
3. System has sufficient memory (recommend at least 4GB available)
4. ffmpeg is installed (check with `which ffmpeg`)

**Q: 500 Internal Server Error**

In most cases, HTTP 500 is not a network issue but a local Python virtual environment problem (missing `venv` or dependencies). Heuristic: if the podcast link opens fine in your browser, it’s unlikely a network issue.

Quick checklist:

```bash
# 1) Ensure you're at the project root
cd /path/to/podcast-transcriber

# 2) Recreate the virtual environment
rm -rf venv
python3 -m venv venv
source venv/bin/activate

# 3) Install dependencies
pip install --upgrade pip
pip install faster-whisper

# 4) Verify python path and ffmpeg
which python     # should be .../podcast-transcriber/venv/bin/python
which ffmpeg     # should point to a valid executable

# 5) Restart the server
npm start
```

If the problem persists, copy the terminal stack trace and open an issue with the logs attached.

**Q: First transcription is very slow**

A: This is normal behavior. Faster-Whisper needs to download model files (~75MB) on first run. Subsequent transcriptions will be much faster.

## 🔧 Advanced Features

### AI Text Optimization

- **Continuity Enhancement**: Seamless connection between transcribed segments
- **Language Preservation**: Maintains original speaker style and expression patterns
- **Filler Word Cleanup**: Intelligent removal of excessive verbal fillers while preserving meaning
- **Structured Summarization**: Hierarchical content organization with key point extraction

### Multi-Platform Support

- **Apple Podcasts**: RSS feed discovery and iTunes API integration
- **Xiaoyuzhoufm**: Native API support with fallback RSS parsing
- **Generic RSS**: Universal podcast feed compatibility
- **Direct Audio**: Support for MP3, M4A, WAV, AAC, and other formats

### Audio Processing
- **Support for Various Duration Podcasts**: Local Faster-Whisper model supports processing audio files of any size
- **Memory Optimization**: Intelligent memory management, suitable for personal devices and workstations
- **Audio Processing Time**: Depends on device performance, network environment, and selected Whisper model


## 🌐 Use Cases

### Personal Users
- **Study Notes**: Convert educational podcasts to text for easy review
- **Content Organization**: Create summary indexes for favorite podcasts
- **Multi-language Learning**: Get transcriptions in different languages for practice

### Professional Users
- **Content Creation**: Use podcast transcriptions for blog and article creation
- **Research Analysis**: Text analysis and citation of academic podcasts
- **Accessibility Support**: Provide text versions for hearing-impaired users

### Enterprise Applications
- **Meeting Records**: Automatic transcription of corporate podcasts and recordings
- **Content Marketing**: SEO optimization of podcast content in text format
- **Knowledge Management**: Integrate audio content into enterprise knowledge bases


## 📄 License

Apache 2.0 License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

This project builds on the open-source work of the original repository by [wendy7756/podcast-transcriber](https://github.com/wendy7756/podcast-transcriber). Thanks to the original author for publishing the initial version and making this derivative work possible.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.
