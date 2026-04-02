/**
 * 文件保存工具模块
 * 所有正式结果统一落在 results/transcriptions 根目录，便于直接浏览全部转录记录。
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const TEMP_ROOT = path.join(REPO_ROOT, 'server', 'temp');
const RESULTS_ROOT = path.join(REPO_ROOT, 'results', 'transcriptions');

const FILE_TYPE_SUFFIX = {
    transcript: 'tr',
    original_transcript: 'tr_raw',
    summary: 'sum',
    translation: 'tl'
};

function ensureDirectory(targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
}

function isPathInside(filePath, rootDir) {
    const resolvedFile = path.resolve(filePath);
    const resolvedRoot = `${path.resolve(rootDir)}${path.sep}`;
    return resolvedFile.startsWith(resolvedRoot);
}

function splitAlphaToken(token) {
    return token
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
}

function abbreviateToken(token) {
    if (!token) {
        return '';
    }

    if (/^[\u4e00-\u9fff]+$/.test(token)) {
        return token.slice(0, Math.min(4, token.length));
    }

    const parts = splitAlphaToken(token);
    if (parts.length > 1) {
        return parts.map((part) => part[0].toLowerCase()).join('').slice(0, 5);
    }

    return token.toLowerCase().slice(0, 5);
}

function abbreviateTitle(title, maxLength = 28) {
    const source = String(title || '')
        .replace(/[<>:"/\\|?*]+/g, ' ')
        .replace(/[|｜:：、，。,！？!?"'“”‘’（）()【】[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!source) {
        return 'untitled';
    }

    const tokens = source.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]{1,8}/g) || [];
    const compact = [];

    for (const token of tokens) {
        const next = abbreviateToken(token);
        if (!next) {
            continue;
        }

        const joined = compact.length ? `${compact.join('_')}_${next}` : next;
        if (joined.length > maxLength) {
            break;
        }

        compact.push(next);
    }

    return (compact.join('_') || 'untitled').replace(/_+/g, '_');
}

function formatDateParts(inputDate = new Date()) {
    const date = new Date(inputDate);
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return {
        day: `${yyyy}-${mm}-${dd}`,
        stamp: `${yyyy}${mm}${dd}_${hh}${min}`
    };
}

function sanitizeRunKey(runKey) {
    return String(runKey || Math.random().toString(36).slice(2, 8))
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 10)
        .toLowerCase() || 'run';
}

function createOutputContext(podcastTitle, options = {}) {
    const { createdAt = new Date(), runKey } = options;
    const { stamp } = formatDateParts(createdAt);
    const titleStem = abbreviateTitle(podcastTitle);
    const suffix = sanitizeRunKey(runKey);
    const artifactStem = `${stamp}_${titleStem}_${suffix}`;

    ensureDirectory(RESULTS_ROOT);

    return {
        titleStem,
        artifactStem,
        outputDir: RESULTS_ROOT
    };
}

function getArtifactFilename(type, outputContext, extension = '.md') {
    const suffix = FILE_TYPE_SUFFIX[type] || type;
    return `${outputContext.artifactStem}_${suffix}${extension}`;
}

function buildDownloadKey(filePath) {
    return Buffer.from(String(filePath), 'utf8').toString('base64url');
}

function decodeDownloadKey(downloadKey) {
    if (!downloadKey) {
        return null;
    }

    try {
        return Buffer.from(String(downloadKey), 'base64url').toString('utf8');
    } catch (_error) {
        return null;
    }
}

function buildSavedFileRecord(type, filePath) {
    const stats = fs.statSync(filePath);
    const filename = path.basename(filePath);

    return {
        type,
        filename,
        downloadName: filename,
        downloadKey: buildDownloadKey(filePath),
        path: filePath,
        size: stats.size
    };
}

function ensureUniquePath(targetPath) {
    if (!fs.existsSync(targetPath)) {
        return targetPath;
    }

    const ext = path.extname(targetPath);
    const base = targetPath.slice(0, -ext.length);
    let counter = 2;

    while (true) {
        const candidate = `${base}_v${counter}${ext}`;
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
        counter += 1;
    }
}

function moveFileSafely(sourcePath, targetPath) {
    if (sourcePath === targetPath) {
        return targetPath;
    }

    try {
        fs.renameSync(sourcePath, targetPath);
    } catch (error) {
        if (error.code !== 'EXDEV') {
            throw error;
        }

        fs.copyFileSync(sourcePath, targetPath);
        fs.unlinkSync(sourcePath);
    }

    return targetPath;
}

function writeManagedTextFile(content, type, outputContext, extension = '.md') {
    const targetPath = ensureUniquePath(path.join(outputContext.outputDir, getArtifactFilename(type, outputContext, extension)));
    fs.writeFileSync(targetPath, content, 'utf8');
    return buildSavedFileRecord(type, targetPath);
}

function enrichSavedFileRecord(file) {
    if (!file?.path || !fs.existsSync(file.path)) {
        return null;
    }

    return {
        ...file,
        filename: path.basename(file.path),
        downloadName: file.downloadName || path.basename(file.path),
        downloadKey: file.downloadKey || buildDownloadKey(file.path),
        size: fs.statSync(file.path).size
    };
}

function migrateSavedFilesToManagedResults(savedFiles, options = {}) {
    const validFiles = Array.isArray(savedFiles) ? savedFiles.filter((file) => file?.path && fs.existsSync(file.path)) : [];
    if (validFiles.length === 0) {
        return [];
    }

    const outputContext = options.outputContext || createOutputContext(options.podcastTitle, {
        createdAt: options.createdAt,
        runKey: options.runKey
    });

    return validFiles.map((file) => {
        if (isPathInside(file.path, RESULTS_ROOT) && path.dirname(path.resolve(file.path)) === path.resolve(RESULTS_ROOT)) {
            return enrichSavedFileRecord(file);
        }

        const ext = path.extname(file.path) || '.md';
        const targetPath = ensureUniquePath(path.join(outputContext.outputDir, getArtifactFilename(file.type, outputContext, ext)));
        moveFileSafely(file.path, targetPath);
        return buildSavedFileRecord(file.type, targetPath);
    }).filter(Boolean);
}

/**
 * 保存转录结果到文件
 * 兼容旧异步路由，但输出目录改为 results/transcriptions。
 */
function saveTranscriptionResults(result, tempDir, shouldSummarize = false, options = {}) {
    const outputContext = options.outputContext || createOutputContext(options.podcastTitle, {
        createdAt: options.createdAt,
        runKey: options.runKey
    });
    const savedFiles = [];

    console.log('💾 保存转录结果到结果目录...');

    try {
        if (result.transcript) {
            savedFiles.push(writeManagedTextFile(result.transcript, 'transcript', outputContext, '.txt'));
        }

        if (shouldSummarize && result.summary) {
            savedFiles.push(writeManagedTextFile(result.summary, 'summary', outputContext, '.txt'));
        }

        return savedFiles;
    } catch (error) {
        console.error('❌ 保存文件时出错:', error);
        savedFiles.forEach((file) => {
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (_cleanupError) {
                // noop
            }
        });

        throw new Error(`文件保存失败: ${error.message}`);
    }
}

/**
 * 清理音频临时文件
 * @param {string} originalAudioPath - 原始音频文件路径
 * @param {Array} audioFiles - 所有音频文件路径数组
 */
function cleanupAudioFiles(originalAudioPath, audioFiles) {
    console.log('🧹 清理音频临时文件...');

    try {
        if (originalAudioPath && fs.existsSync(originalAudioPath)) {
            fs.unlinkSync(originalAudioPath);
            console.log(`🗑️ 已清理原始文件: ${path.basename(originalAudioPath)}`);
        }

        if (Array.isArray(audioFiles) && audioFiles.length > 1) {
            let cleanedCount = 0;
            for (const file of audioFiles) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    cleanedCount += 1;
                }
            }
            console.log(`✅ 已清理 ${cleanedCount} 个音频片段文件`);
        }
    } catch (error) {
        console.warn('⚠️ 清理音频文件时出错:', error.message);
    }
}

function ensureTempDirectory(tempDir) {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`📁 创建临时目录: ${tempDir}`);
    }
}

module.exports = {
    RESULTS_ROOT,
    TEMP_ROOT,
    abbreviateTitle,
    buildDownloadKey,
    buildSavedFileRecord,
    cleanupAudioFiles,
    createOutputContext,
    decodeDownloadKey,
    ensureTempDirectory,
    enrichSavedFileRecord,
    isPathInside,
    migrateSavedFilesToManagedResults,
    saveTranscriptionResults,
    writeManagedTextFile
};
