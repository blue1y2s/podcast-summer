const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const {
    SUPPORTED_ASR_BACKENDS,
    normalizeAsrBackend,
    processAudioWithOpenAI,
    buildStructuredTranscript,
    hasNativeStructuredTranscript,
    formatTranscriptAsMarkdown,
    normalizeTranscriptSpeakerLabels
} = require('./services/openaiService');
const { downloadPodcastAudio, estimateVideoDuration, isSupportedVideoUrl } = require('./services/podcastService');
const { getAudioFiles, estimateAudioDuration } = require('./services/audioInfoService');
const {
    RESULTS_ROOT,
    cleanupAudioFiles,
    decodeDownloadKey,
    enrichSavedFileRecord,
    isPathInside,
    migrateSavedFilesToManagedResults
} = require('./utils/fileSaver');
const { formatSizeKB, formatSizeMB, estimateAudioDurationFromSize } = require('./utils/formatUtils');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');
const CLIENT_DIR = fs.existsSync(path.join(DIST_DIR, 'index.html')) ? DIST_DIR : PUBLIC_DIR;

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务
app.use(express.static(CLIENT_DIR));

// 创建临时文件夹
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}
const latestResultPath = path.join(tempDir, 'latest-result.json');
const historyDir = path.join(tempDir, 'history');
const historyIndexPath = path.join(tempDir, 'history-index.json');
const HISTORY_LIMIT = 40;

if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
}

// 文件上传配置
const upload = multer({
    dest: tempDir,
    limits: {
        fileSize: (process.env.MAX_FILE_SIZE || 500) * 1024 * 1024 // 默认500MB，便于桌面端导入长音频
    }
});

// 进度推送存储
const progressClients = new Map();

// SSE 进度推送端点
app.get('/api/progress/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log(`🔌 新的SSE连接: sessionId=${sessionId}`);
    
    // 设置 SSE 头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // 存储客户端连接
    progressClients.set(sessionId, res);
    console.log(`📝 已存储客户端连接，当前连接数: ${progressClients.size}`);
    
    // 发送初始连接确认
    res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);
    
    // 客户端断开连接时清理
    req.on('close', () => {
        console.log(`🔌 SSE连接断开: sessionId=${sessionId}`);
        progressClients.delete(sessionId);
    });
});

// 发送进度更新的辅助函数
function sendProgress(sessionId, progress, stage, stageText) {
    console.log(`📊 尝试发送进度: sessionId=${sessionId}, progress=${progress}%, stage=${stage}, text=${stageText}`);
    const client = progressClients.get(sessionId);
    if (client) {
        const data = {
            type: 'progress',
            progress: Math.round(progress),
            stage,
            stageText
        };
        console.log(`✅ 发送进度更新: ${JSON.stringify(data)}`);
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
        console.log(`❌ 未找到 sessionId=${sessionId} 的客户端连接`);
    }
}

function getTempResolvedPath(filename) {
    const resolvedPath = path.resolve(tempDir, filename);
    const tempRoot = `${path.resolve(tempDir)}${path.sep}`;

    if (!resolvedPath.startsWith(tempRoot)) {
        throw new Error('无效的文件路径 / Invalid file path');
    }

    return resolvedPath;
}

function getManagedResolvedPath(downloadKey) {
    const decodedPath = decodeDownloadKey(downloadKey);
    if (!decodedPath) {
        throw new Error('无效的下载参数');
    }

    const resolvedPath = path.resolve(decodedPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error('文件未找到');
    }

    if (!isPathInside(resolvedPath, RESULTS_ROOT) && !isPathInside(resolvedPath, tempDir)) {
        throw new Error('无效的文件路径');
    }

    return resolvedPath;
}

function cleanupProcessingArtifacts(sourcePath, audioFiles = []) {
    if (!sourcePath) {
        return;
    }

    cleanupAudioFiles(sourcePath, audioFiles);
}

function looksLikeOpaqueTitle(title) {
    const value = String(title || '').trim();

    if (!value) {
        return false;
    }

    return /^[a-f0-9]{16,}$/i.test(value) || /^[A-Z0-9_-]{24,}$/i.test(value);
}

function getReadableResultTitle(title, sourceMode) {
    const value = String(title || '').trim();

    if (value && !looksLikeOpaqueTitle(value)) {
        return value;
    }

    return sourceMode === 'file' ? 'Local audio' : 'Untitled result';
}

function createHistoryId() {
    return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function getHistorySnapshotPath(historyId) {
    return path.join(historyDir, `${historyId}.json`);
}

function isManagedRootFile(filePath) {
    return isPathInside(filePath, RESULTS_ROOT) && path.dirname(path.resolve(filePath)) === path.resolve(RESULTS_ROOT);
}

function removeEmptyParentDirectories(startDir, stopDir = RESULTS_ROOT) {
    let currentDir = path.resolve(startDir);
    const resolvedStopDir = path.resolve(stopDir);

    while (currentDir.startsWith(resolvedStopDir) && currentDir !== resolvedStopDir) {
        if (!fs.existsSync(currentDir)) {
            currentDir = path.dirname(currentDir);
            continue;
        }

        if (fs.readdirSync(currentDir).length > 0) {
            break;
        }

        fs.rmdirSync(currentDir);
        currentDir = path.dirname(currentDir);
    }
}

function sanitizeSavedFiles(savedFiles) {
    return Array.isArray(savedFiles)
        ? savedFiles
            .filter((file) => file?.path && fs.existsSync(file.path))
            .map((file) => enrichSavedFileRecord(file))
            .filter(Boolean)
        : [];
}

function stripTranscriptMarkdown(content) {
    return String(content || '')
        .replace(/^#.*$/gm, '')
        .replace(/^\*\*Source:\*\*.*$/gm, '')
        .replace(/^---$/gm, '')
        .trim();
}

function getSnapshotTranscriptSource(data) {
    const transcriptFile = data?.savedFiles?.find((file) => file.type === 'transcript' && file.path && fs.existsSync(file.path));
    if (transcriptFile) {
        return stripTranscriptMarkdown(fs.readFileSync(transcriptFile.path, 'utf8'));
    }

    const rawTranscriptFile = data?.savedFiles?.find((file) => file.type === 'original_transcript' && file.path && fs.existsSync(file.path));
    if (rawTranscriptFile) {
        return stripTranscriptMarkdown(fs.readFileSync(rawTranscriptFile.path, 'utf8'));
    }

    return String(data?.transcript || '');
}

function migrateSnapshotFiles(snapshotPath, payload) {
    if (!payload?.data) {
        return payload;
    }

    let nextPayload = payload;
    let shouldPersist = false;
    const currentFiles = Array.isArray(payload.data.savedFiles)
        ? payload.data.savedFiles.filter((file) => file?.path && fs.existsSync(file.path))
        : [];

    if (currentFiles.length > 0) {
        const migratedFiles = migrateSavedFilesToManagedResults(currentFiles, {
            podcastTitle: payload.data.podcastTitle,
            createdAt: payload.updatedAt,
            runKey: payload.id || payload.data.historyId || 'legacy'
        });
        const filesChanged = currentFiles.length !== migratedFiles.length
            || currentFiles.some((file, index) =>
                file.path !== migratedFiles[index]?.path
                || file.downloadKey !== migratedFiles[index]?.downloadKey
                || file.size !== migratedFiles[index]?.size
            );

        nextPayload = {
            ...nextPayload,
            data: {
                ...nextPayload.data,
                savedFiles: migratedFiles
            }
        };

        if (nextPayload.data.activeFilePath) {
            const activeType = currentFiles.find((file) => file.path === nextPayload.data.activeFilePath)?.type;
            const activeFile = migratedFiles.find((file) => file.type === activeType)
                || migratedFiles.find((file) => file.type === 'transcript')
                || migratedFiles[0]
                || null;

            nextPayload.data.activeFilePath = activeFile?.path || nextPayload.data.activeFilePath;
        }

        shouldPersist = shouldPersist || filesChanged;
    }

    const transcriptSource = getSnapshotTranscriptSource(nextPayload.data);
    if (transcriptSource) {
        const preserveStructuredTranscript = hasNativeStructuredTranscript(nextPayload.data.structuredTranscript);
        const normalizedTranscript = preserveStructuredTranscript
            ? transcriptSource
            : normalizeTranscriptSpeakerLabels(transcriptSource);
        const transcriptChanged = Boolean(normalizedTranscript) && normalizedTranscript !== nextPayload.data.transcript;
        const rebuiltStructuredTranscript = preserveStructuredTranscript
            ? nextPayload.data.structuredTranscript
            : buildStructuredTranscript(
                transcriptChanged ? normalizedTranscript : nextPayload.data.transcript,
                nextPayload.data.actualDuration || nextPayload.data.audioDuration || nextPayload.data.duration || null
            );
        const structuredChanged = !preserveStructuredTranscript
            && JSON.stringify(nextPayload.data.structuredTranscript || null) !== JSON.stringify(rebuiltStructuredTranscript);

        if (transcriptChanged || structuredChanged) {
            nextPayload = {
                ...nextPayload,
                data: {
                    ...nextPayload.data,
                    transcript: transcriptChanged ? normalizedTranscript : nextPayload.data.transcript,
                    structuredTranscript: rebuiltStructuredTranscript
                }
            };
            shouldPersist = true;

            const transcriptFile = nextPayload.data.savedFiles?.find((file) => file.type === 'transcript' && file.path && fs.existsSync(file.path));
            if (transcriptFile) {
                fs.writeFileSync(
                    transcriptFile.path,
                    formatTranscriptAsMarkdown(nextPayload.data.transcript, nextPayload.data.podcastTitle, nextPayload.data.sourceUrl || null),
                    'utf8'
                );
                transcriptFile.size = fs.statSync(transcriptFile.path).size;
            }
        }
    }

    if (shouldPersist && snapshotPath) {
        try {
            fs.writeFileSync(snapshotPath, JSON.stringify(nextPayload, null, 2), 'utf8');
        } catch (error) {
            console.error('写回迁移后的快照失败:', error);
        }
    }

    return nextPayload;
}

function normalizeSnapshotPayload(payload) {
    if (!payload?.data) {
        return null;
    }

    const historyId = payload.id || payload.data.historyId || null;
    const savedFiles = sanitizeSavedFiles(payload.data.savedFiles);

    return {
        id: historyId,
        updatedAt: payload.updatedAt || null,
        data: {
            ...payload.data,
            historyId,
            savedFiles
        }
    };
}

function buildHistoryEntry(snapshot) {
    if (!snapshot?.data) {
        return null;
    }

    return {
        id: snapshot.id,
        updatedAt: snapshot.updatedAt,
        podcastTitle: getReadableResultTitle(snapshot.data.podcastTitle, snapshot.data.sourceMode),
        sourceMode: snapshot.data.sourceMode || 'url',
        sourceUrl: snapshot.data.sourceUrl || null,
        sourceFilename: snapshot.data.sourceFilename || null,
        publishedAt: snapshot.data.publishedAt || null,
        detectedLanguage: snapshot.data.detectedLanguage || null,
        durationSeconds: snapshot.data.actualDuration || snapshot.data.audioDuration || snapshot.data.duration || snapshot.data.estimatedDuration || null,
        savedFileCount: snapshot.data.savedFiles?.length || 0,
        hasSummary: Boolean(snapshot.data.summary),
        hasTranslation: Boolean(snapshot.data.translation),
        historyId: snapshot.id
    };
}

function readHistoryIndex() {
    if (!fs.existsSync(historyIndexPath)) {
        return [];
    }

    try {
        const payload = JSON.parse(fs.readFileSync(historyIndexPath, 'utf8'));
        return Array.isArray(payload) ? payload : [];
    } catch (error) {
        console.error('读取历史索引失败:', error);
        return [];
    }
}

function writeHistoryIndex(entries) {
    try {
        fs.writeFileSync(historyIndexPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch (error) {
        console.error('写入历史索引失败:', error);
    }
}

function readHistorySnapshot(historyId) {
    const snapshotPath = getHistorySnapshotPath(historyId);
    if (!fs.existsSync(snapshotPath)) {
        return null;
    }

    try {
        const payload = migrateSnapshotFiles(snapshotPath, JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
        return normalizeSnapshotPayload(payload);
    } catch (error) {
        console.error('读取历史快照失败:', error);
        return null;
    }
}

function listHistoryEntries() {
    const entries = readHistoryIndex();
    const validEntries = entries.filter((entry) => entry?.id && fs.existsSync(getHistorySnapshotPath(entry.id)));

    if (validEntries.length !== entries.length) {
        writeHistoryIndex(validEntries);
    }

    return validEntries;
}

function getValidHistoryEntries(entries = readHistoryIndex()) {
    return entries.filter((entry) => entry?.id && fs.existsSync(getHistorySnapshotPath(entry.id)));
}

function seedHistoryFromLatestSnapshot() {
    const latestSnapshot = readLatestResultSnapshot();
    if (!latestSnapshot?.data) {
        return;
    }

    const historyId = latestSnapshot.id || latestSnapshot.data.historyId || `legacy-${crypto
        .createHash('sha1')
        .update(JSON.stringify({
            updatedAt: latestSnapshot.updatedAt,
            title: latestSnapshot.data.podcastTitle,
            firstFile: latestSnapshot.data.savedFiles?.[0]?.filename || ''
        }))
        .digest('hex')
        .slice(0, 12)}`;

    const snapshotPath = getHistorySnapshotPath(historyId);
    const normalizedPayload = {
        id: historyId,
        updatedAt: latestSnapshot.updatedAt || new Date().toISOString(),
        data: {
            ...latestSnapshot.data,
            historyId,
            podcastTitle: getReadableResultTitle(latestSnapshot.data.podcastTitle, latestSnapshot.data.sourceMode)
        }
    };

    if (!fs.existsSync(snapshotPath)) {
        try {
            fs.writeFileSync(snapshotPath, JSON.stringify(normalizedPayload, null, 2), 'utf8');
        } catch (error) {
            console.error('补历史快照失败:', error);
        }
    }

    const entries = readHistoryIndex();
    if (!entries.some((entry) => entry.id === historyId)) {
        const nextEntries = [
            buildHistoryEntry(normalizeSnapshotPayload(normalizedPayload)),
            ...entries
        ].filter(Boolean).slice(0, HISTORY_LIMIT);
        writeHistoryIndex(nextEntries);
    }

    if (!latestSnapshot.id || !latestSnapshot.data.historyId) {
        try {
            fs.writeFileSync(latestResultPath, JSON.stringify(normalizedPayload, null, 2), 'utf8');
        } catch (error) {
            console.error('补最近结果快照失败:', error);
        }
    }
}

function migrateStoredSnapshots() {
    if (fs.existsSync(latestResultPath)) {
        try {
            migrateSnapshotFiles(latestResultPath, JSON.parse(fs.readFileSync(latestResultPath, 'utf8')));
        } catch (error) {
            console.error('迁移最近结果快照失败:', error);
        }
    }

    if (fs.existsSync(historyDir)) {
        fs.readdirSync(historyDir)
            .filter((file) => file.endsWith('.json'))
            .forEach((file) => {
                const snapshotPath = path.join(historyDir, file);
                try {
                    migrateSnapshotFiles(snapshotPath, JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
                } catch (error) {
                    console.error(`迁移历史快照失败: ${file}`, error);
                }
            });
    }
}

function persistLatestResultSnapshot(resultData) {
    try {
        const historyId = resultData.historyId || createHistoryId();
        const updatedAt = new Date().toISOString();
        const normalizedData = {
            ...resultData,
            historyId,
            podcastTitle: getReadableResultTitle(resultData.podcastTitle, resultData.sourceMode),
            savedFiles: sanitizeSavedFiles(resultData.savedFiles)
        };
        const snapshotPayload = {
            id: historyId,
            updatedAt,
            data: normalizedData
        };

        fs.writeFileSync(
            latestResultPath,
            JSON.stringify(snapshotPayload, null, 2),
            'utf8'
        );

        fs.writeFileSync(
            getHistorySnapshotPath(historyId),
            JSON.stringify(snapshotPayload, null, 2),
            'utf8'
        );

        const nextEntries = [
            buildHistoryEntry(snapshotPayload),
            ...readHistoryIndex().filter((entry) => entry?.id !== historyId)
        ].filter(Boolean).slice(0, HISTORY_LIMIT);

        writeHistoryIndex(nextEntries);
        return snapshotPayload;
    } catch (error) {
        console.error('保存最近结果快照失败:', error);
        return null;
    }
}

function readLatestResultSnapshot() {
    if (!fs.existsSync(latestResultPath)) {
        return null;
    }

    try {
        const payload = migrateSnapshotFiles(latestResultPath, JSON.parse(fs.readFileSync(latestResultPath, 'utf8')));
        return normalizeSnapshotPayload(payload);
    } catch (error) {
        console.error('读取最近结果快照失败:', error);
        return null;
    }
}

function deleteManagedSavedFiles(savedFiles) {
    const deletedPaths = new Set();

    for (const file of sanitizeSavedFiles(savedFiles)) {
        if (!file?.path || deletedPaths.has(file.path) || !fs.existsSync(file.path)) {
            continue;
        }

        if (!isPathInside(file.path, RESULTS_ROOT)) {
            continue;
        }

        fs.unlinkSync(file.path);
        deletedPaths.add(file.path);
        removeEmptyParentDirectories(path.dirname(file.path));
    }

    return deletedPaths.size;
}

function persistSnapshotFile(targetPath, snapshot) {
    fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

function deleteHistoryRecord(historyId) {
    const entries = readHistoryIndex();
    const snapshotPath = getHistorySnapshotPath(historyId);
    const snapshot = readHistorySnapshot(historyId);
    const latestSnapshot = readLatestResultSnapshot();
    const existsInIndex = entries.some((entry) => entry?.id === historyId);
    const matchesLatest = latestSnapshot?.id === historyId || latestSnapshot?.data?.historyId === historyId;
    const snapshotExists = fs.existsSync(snapshotPath);

    if (!snapshot?.data && !existsInIndex && !matchesLatest && !snapshotExists) {
        return {
            deletedFileCount: 0,
            nextHistoryId: getValidHistoryEntries(entries)[0]?.id || null,
            alreadyMissing: true
        };
    }

    const deletedFileCount = snapshot?.data ? deleteManagedSavedFiles(snapshot.data.savedFiles) : 0;

    if (snapshotExists) {
        fs.unlinkSync(snapshotPath);
    }

    const remainingEntries = entries.filter((entry) => entry?.id && entry.id !== historyId);
    const validRemainingEntries = getValidHistoryEntries(remainingEntries);
    writeHistoryIndex(validRemainingEntries);

    if (matchesLatest) {
        if (validRemainingEntries.length > 0) {
            const nextSnapshot = readHistorySnapshot(validRemainingEntries[0].id);
            if (nextSnapshot) {
                persistSnapshotFile(latestResultPath, nextSnapshot);
            } else if (fs.existsSync(latestResultPath)) {
                fs.unlinkSync(latestResultPath);
            }
        } else if (fs.existsSync(latestResultPath)) {
            fs.unlinkSync(latestResultPath);
        }
    }

    return {
        deletedFileCount,
        nextHistoryId: validRemainingEntries[0]?.id || null
    };
}

migrateStoredSnapshots();
seedHistoryFromLatestSnapshot();

// API路由
app.post('/api/upload-audio', upload.single('audioFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: '缺少音频文件 / Missing audio file'
            });
        }

        const sessionId = req.body?.sessionId;
        const originalExtension = path.extname(req.file.originalname || '').toLowerCase();
        const safeExtension = originalExtension && /^[.\w-]+$/.test(originalExtension)
            ? originalExtension
            : path.extname(req.file.filename) || '.audio';
        const storedFilename = `${req.file.filename}${safeExtension}`;
        const storedPath = getTempResolvedPath(storedFilename);

        fs.renameSync(req.file.path, storedPath);

        if (sessionId) {
            sendProgress(sessionId, 14, 'upload', req.file.originalname || 'Audio uploaded');
        }

        res.json({
            success: true,
            data: {
                filename: storedFilename,
                originalName: req.file.originalname,
                size: req.file.size,
                mimeType: req.file.mimetype
            }
        });
    } catch (error) {
        console.error('上传音频失败:', error);
        res.status(500).json({
            success: false,
            error: error.message || '上传音频失败 / Audio upload failed'
        });
    }
});

app.post('/api/process-podcast', async (req, res) => {
    let originalAudioPath = null;
    let audioFiles = [];

    try {
        const {
            url,
            operation,
            audioLanguage,
            outputLanguage,
            sessionId,
            asrBackend = 'auto',
            hotwords = '',
            transcriptionContext = ''
        } = req.body;
        const normalizedAsrBackend = normalizeAsrBackend(asrBackend);

        console.log('处理播客请求:', {
            url,
            operation,
            audioLanguage,
            outputLanguage,
            sessionId,
            asrBackend: normalizedAsrBackend || asrBackend,
            hasHotwords: Boolean(String(hotwords || '').trim()),
            hasContext: Boolean(String(transcriptionContext || '').trim())
        });

        // 验证输入
        if (!url) {
            return res.status(400).json({
                success: false,
                error: '播客链接是必需的 / Podcast URL is required'
            });
        }

        if (!['transcribe_only', 'transcribe_summarize'].includes(operation)) {
            return res.status(400).json({
                success: false,
                error: '无效的操作类型 / Invalid operation type'
            });
        }

        if (!normalizedAsrBackend) {
            return res.status(400).json({
                success: false,
                error: `无效的 ASR backend，可选值: ${SUPPORTED_ASR_BACKENDS.join(', ')}`
            });
        }

        if (isSupportedVideoUrl(url) && normalizedAsrBackend === 'fun_asr_file_diarization') {
            return res.status(400).json({
                success: false,
                error: 'Fun-ASR 文件分离只支持公网音频直链；B 站/YouTube 视频请使用 auto、Gemini、Qwen3、Fun-ASR 实时或本地 Whisper 后端。'
            });
        }

        // 步骤1: 下载音频文件
        console.log('下载音频文件...');
        if (sessionId) {
            const stageText = outputLanguage === 'zh' ? '处理音频' : 'Processing Audio';
            sendProgress(sessionId, 10, 'download', stageText);
        }
        
        const podcastInfo = await downloadPodcastAudio(url);
        
        if (!podcastInfo || !podcastInfo.audioFilePath) {
            return res.status(400).json({
                success: false,
                error: '无法下载音频文件，请检查链接是否有效 / Unable to download audio file, please check if the link is valid'
            });
        }

        originalAudioPath = podcastInfo.audioFilePath;
        const podcastTitle = podcastInfo.title || 'Untitled Podcast';

        // 步骤2: 基于文件大小估算时长（用于初始预估）
        console.log('📊 估算音频时长...');
        if (sessionId) {
            const stageText = outputLanguage === 'zh' ? '处理音频' : 'Processing Audio';
            sendProgress(sessionId, 20, 'download', stageText);
        }
        
        const estimatedDuration = await estimateAudioDuration(originalAudioPath);
        console.log(`🎯 预估时长: ${Math.round(estimatedDuration / 60)} 分钟 ${Math.round(estimatedDuration % 60)} 秒`);

        // 步骤3: 获取音频文件信息
        console.log('🔍 获取音频文件信息...');
        audioFiles = await getAudioFiles(originalAudioPath);
        
        const shouldSummarize = operation === 'transcribe_summarize';
        console.log(`📋 处理模式: ${shouldSummarize ? '转录+总结' : '仅转录'}`);
        
        // 步骤4: 使用配置的 ASR backend 处理音频
        console.log(`🤖 ASR 处理 ${audioFiles.length} 个音频文件，backend=${normalizedAsrBackend}...`);
        if (sessionId) {
            const stageText = outputLanguage === 'zh' ? '转录' : 'Transcription';
            sendProgress(sessionId, 30, 'transcription', stageText);
        }
        
        const result = await processAudioWithOpenAI(
            audioFiles,
            shouldSummarize,
            outputLanguage,
            tempDir,
            audioLanguage,
            url,
            sessionId,
            sendProgress,
            podcastTitle,
            {
                asrBackend: normalizedAsrBackend,
                hotwords,
                transcriptionContext,
                sourcePlatform: podcastInfo.platform || null,
                sourceAudioUrl: podcastInfo.platform ? null : podcastInfo.audioUrl || null
            }
        );

        // 步骤4: 获取保存的文件信息
        const savedFiles = result.savedFiles || [];
        console.log(`✅ 处理完成，共保存 ${savedFiles.length} 个文件`);
        
        // 打印保存的文件详情
        savedFiles.forEach(file => {
            console.log(`📁 ${file.type}: ${file.filename} (${formatSizeKB(file.size)})`);
        });

        // 发送完成进度
        if (sessionId) {
            const stageText = outputLanguage === 'zh' ? '处理完成' : 'Complete';
            sendProgress(sessionId, 100, 'complete', stageText);
        }

        const responseData = {
            ...result,
            podcastTitle: podcastTitle,
            estimatedDuration: estimatedDuration,
            actualDuration: result.audioDuration || result.duration || podcastInfo.duration || null,
            savedFiles: savedFiles,
            sourceMode: 'url',
            sourceUrl: url,
            sourcePlatform: podcastInfo.platform || null,
            publishedAt: podcastInfo.publishedAt || null
        };

        const persistedSnapshot = persistLatestResultSnapshot(responseData);
        const finalizedResponseData = persistedSnapshot
            ? {
                ...responseData,
                historyId: persistedSnapshot.id,
                updatedAt: persistedSnapshot.updatedAt
            }
            : responseData;

        // 返回结果（包含估算和真实时长）
        res.json({
            success: true,
            data: finalizedResponseData
        });

    } catch (error) {
        console.error('处理播客时出错:', error);

        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        res.status(statusCode).json({
            success: false,
            error: error.message || '服务器内部错误 / Internal server error'
        });
    } finally {
        cleanupProcessingArtifacts(originalAudioPath, audioFiles);
    }
});

// 本地文件处理端点
app.post('/api/process-local-file', async (req, res) => {
    let filePath = null;
    let audioFiles = [];
    let cleanupNeeded = false;

    try {
        const {
            filename,
            originalName,
            operation = 'transcribe_only',
            outputLanguage = 'zh',
            audioLanguage = 'auto',
            sessionId = null,
            asrBackend = 'auto',
            hotwords = '',
            transcriptionContext = ''
        } = req.body;
        const normalizedAsrBackend = normalizeAsrBackend(asrBackend);
        
        if (!filename) {
            return res.status(400).json({
                success: false,
                error: '缺少文件名参数'
            });
        }
        
        filePath = getTempResolvedPath(filename);
        cleanupNeeded = true;
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: '文件未找到'
            });
        }

        if (!normalizedAsrBackend) {
            return res.status(400).json({
                success: false,
                error: `无效的 ASR backend，可选值: ${SUPPORTED_ASR_BACKENDS.join(', ')}`
            });
        }
        
        console.log(`📂 处理本地文件: ${filename}`);
        console.log(`📋 处理模式: ${operation === 'transcribe_summarize' ? '转录+总结' : '仅转录'}`);
        console.log(`🎧 原始文件名: ${originalName || filename}`);
        console.log(`🧠 ASR backend: ${normalizedAsrBackend}`);

        const localTitle = path.parse(originalName || filename).name;
        const estimatedDuration = await estimateAudioDuration(filePath);
        audioFiles = await getAudioFiles(filePath);
        
        const shouldSummarize = operation === 'transcribe_summarize';
        
        // 使用配置的 ASR backend 处理音频
        console.log(`🤖 ASR 处理文件: ${filename}, backend=${normalizedAsrBackend}`);
        if (sessionId) {
            sendProgress(sessionId, 24, 'transcription', outputLanguage === 'zh' ? '转录本地音频' : 'Transcribing local audio');
        }
        const result = await processAudioWithOpenAI(
            audioFiles,
            shouldSummarize,
            outputLanguage,
            tempDir,
            audioLanguage,
            null,
            sessionId,
            sendProgress,
            localTitle,
            {
                asrBackend: normalizedAsrBackend,
                hotwords,
                transcriptionContext
            }
        );

        // 获取保存的文件信息
        const savedFiles = result.savedFiles || [];
        console.log(`✅ 处理完成，共保存 ${savedFiles.length} 个文件`);
        
        // 打印保存的文件详情
        savedFiles.forEach(file => {
            console.log(`📁 ${file.type}: ${file.filename} (${formatSizeKB(file.size)})`);
        });
        
        const responseData = {
            ...result,
            podcastTitle: localTitle,
            estimatedDuration: estimatedDuration,
            actualDuration: result.audioDuration || result.duration,
            savedFiles: savedFiles,
            sourceMode: 'file',
            sourceFilename: originalName || filename
        };

        const persistedSnapshot = persistLatestResultSnapshot(responseData);
        const finalizedResponseData = persistedSnapshot
            ? {
                ...responseData,
                historyId: persistedSnapshot.id,
                updatedAt: persistedSnapshot.updatedAt
            }
            : responseData;

        // 返回结果
        res.json({
            success: true,
            data: finalizedResponseData
        });

    } catch (error) {
        console.error('本地文件处理失败:', error);
        const statusCode = error.message && error.message.includes('无效的文件路径') ? 400 : 500;
        res.status(statusCode).json({
            success: false,
            error: error.message || '本地文件处理失败 / Local file processing failed'
        });
    } finally {
        if (cleanupNeeded) {
            cleanupProcessingArtifacts(filePath, audioFiles);
        }
    }
});

// 获取temp目录文件列表端点
app.get('/api/temp-files', (req, res) => {
    try {
        const files = fs.readdirSync(tempDir)
            .filter(file => 
                // 音频文件
                file.endsWith('.m4a') || file.endsWith('.mp3') || file.endsWith('.wav') ||
                // 转录和总结文件
                file.endsWith('_transcript.md') || file.endsWith('_summary.md') ||
                // 其他文本文件
                file.endsWith('.txt') || file.endsWith('.md')
            )
            .map(file => {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.ctime,
                    modified: stats.mtime
                };
            })
            .sort((a, b) => b.modified - a.modified);
            
        res.json({
            success: true,
            files: files
        });
        
    } catch (error) {
        console.error('获取文件列表失败:', error);
        res.status(500).json({
            success: false,
            error: '获取文件列表失败'
        });
    }
});

app.get('/api/latest-result', (req, res) => {
    const snapshot = readLatestResultSnapshot();

    if (!snapshot) {
        return res.status(404).json({
            success: false,
            error: '暂无最近结果'
        });
    }

    res.json({
        success: true,
        updatedAt: snapshot.updatedAt,
        data: snapshot.data
    });
});

app.get('/api/history', (req, res) => {
    res.json({
        success: true,
        items: listHistoryEntries()
    });
});

app.get('/api/history/:historyId', (req, res) => {
    const snapshot = readHistorySnapshot(req.params.historyId);

    if (!snapshot) {
        return res.status(404).json({
            success: false,
            error: '历史记录未找到'
        });
    }

    res.json({
        success: true,
        updatedAt: snapshot.updatedAt,
        data: snapshot.data
    });
});

app.delete('/api/history/:historyId', (req, res) => {
    try {
        const result = deleteHistoryRecord(req.params.historyId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: '历史记录未找到'
            });
        }

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('删除历史记录失败:', error);
        res.status(500).json({
            success: false,
            error: error.message || '删除历史记录失败'
        });
    }
});

// 文件下载端点
app.get('/api/download/:filename', (req, res) => {
    try {
        const downloadKey = req.query?.key;
        const filePath = downloadKey
            ? getManagedResolvedPath(downloadKey)
            : getTempResolvedPath(req.params.filename);
        const filename = path.basename(filePath);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: '文件未找到'
            });
        }

        // 设置下载响应头
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        // 发送文件
        res.sendFile(filePath);

    } catch (error) {
        console.error('文件下载失败:', error);
        res.status(500).json({
            success: false,
            error: '文件下载失败'
        });
    }
});

// 健康检查端点
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 音频时长预估端点 - 轻量级，只获取文件大小
app.post('/api/estimate-duration', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: '请提供音频链接'
            });
        }

        console.log(`🔍 轻量级预估音频时长: ${url}`);

        if (isSupportedVideoUrl(url)) {
            const videoDuration = await estimateVideoDuration(url);
            if (videoDuration) {
                console.log(`📊 视频元数据时长: ${Math.round(videoDuration / 60)} 分钟`);
                return res.json({
                    success: true,
                    estimatedDuration: videoDuration
                });
            }
        }
        
        // 使用 HEAD 请求获取文件大小，不下载完整文件
        const headResponse = await axios.head(url, {
            timeout: 10000, // 10秒超时
            maxRedirects: 5
        });
        
        const contentLength = parseInt(headResponse.headers['content-length'] || '0');
        if (contentLength > 0) {
            // 基于文件大小估算时长（使用统一工具函数）
            const estimatedDuration = estimateAudioDurationFromSize(contentLength);
            
            console.log(`📊 文件大小: ${formatSizeMB(contentLength)}，预估时长: ${Math.round(estimatedDuration / 60)} 分钟`);
            
            res.json({
                success: true,
                estimatedDuration: estimatedDuration // 返回秒数
            });
        } else {
            // 无法获取文件大小，返回默认估算
            console.log(`⚠️ 无法获取文件大小，使用默认估算`);
            res.json({
                success: true,
                estimatedDuration: 600 // 默认10分钟
            });
        }
        
    } catch (error) {
        console.error('❌ 预估音频时长失败:', error);
        // 失败时返回默认估算，不阻塞主流程
        res.json({
            success: true,
            estimatedDuration: 600 // 默认10分钟
        });
    }
});

// 错误处理中间件
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            error: '音频文件过大，请调高 MAX_FILE_SIZE 或改用播客链接 / Audio file is too large'
        });
    }

    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error: error.message || '文件上传失败 / File upload failed'
        });
    }

    console.error('未处理的错误:', error);
    res.status(500).json({
        success: false,
        error: '服务器内部错误 / Internal server error'
    });
});

// 404处理
app.use((req, res) => {
    if (req.url.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'API端点未找到 / API endpoint not found'
        });
    } else {
        res.sendFile(path.join(CLIENT_DIR, 'index.html'));
    }
});

// 启动服务器（简化版端口处理）
function startServer() {
    const server = app.listen(DEFAULT_PORT, () => {
        console.log(`🎙️ Podcast Summer 服务器运行在 http://localhost:${DEFAULT_PORT}`);
        console.log(`🎙️ Podcast Summer server running on http://localhost:${DEFAULT_PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`端口 ${DEFAULT_PORT} 被占用，尝试端口 ${DEFAULT_PORT + 1}...`);
            const altServer = app.listen(DEFAULT_PORT + 1, () => {
                console.log(`🎙️ Podcast Summer 服务器运行在 http://localhost:${DEFAULT_PORT + 1}`);
                console.log(`🎙️ Podcast Summer server running on http://localhost:${DEFAULT_PORT + 1}`);
            });
            
            altServer.on('error', (altErr) => {
                if (altErr.code === 'EADDRINUSE') {
                    console.log(`端口 ${DEFAULT_PORT + 1} 也被占用，尝试端口 ${DEFAULT_PORT + 2}...`);
                    app.listen(DEFAULT_PORT + 2, () => {
                        console.log(`🎙️ Podcast Summer 服务器运行在 http://localhost:${DEFAULT_PORT + 2}`);
                        console.log(`🎙️ Podcast Summer server running on http://localhost:${DEFAULT_PORT + 2}`);
                    });
                } else {
                    console.error('启动服务器失败:', altErr);
                    process.exit(1);
                }
            });
        } else {
            console.error('启动服务器失败:', err);
            process.exit(1);
        }
    });
}

startServer();
