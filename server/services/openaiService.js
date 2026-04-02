const OpenAI = require('openai');
const { GoogleGenAI, createUserContent, createPartFromUri } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const { createOutputContext, writeManagedTextFile } = require('../utils/fileSaver');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * 将翻译内容格式化为Markdown
 */
function formatTranslationAsMarkdown(translatedText, podcastTitle, targetLanguage = 'zh', sourceUrl = null) {
    // 使用播客实际标题，而不是文件名
    const finalTitle = podcastTitle ? `# 🌍 ${podcastTitle}` : `# 🌍 Podcast Translation`;

    // 添加source链接（如果提供）
    const sourceSection = sourceUrl ? `\n\n---\n\n**Source:** ${sourceUrl}` : '';

    return `${finalTitle}

${translatedText}${sourceSection}
`;
}

/**
 * 将总结格式化为Markdown - 简洁版本
 */
function formatSummaryAsMarkdown(summary, podcastTitle, outputLanguage = 'zh', sourceUrl = null) {
    // 使用播客实际标题，而不是文件名
    const finalTitle = podcastTitle ? `# 🎙️ ${podcastTitle}` : `# 🎙️ Podcast Summary`;

    // 添加source链接（如果提供）
    const sourceSection = sourceUrl ? `\n\n---\n\n**Source:** ${sourceUrl}` : '';

    return `${finalTitle}

${summary}${sourceSection}
`;
}

/**
 * 将转录内容格式化为Markdown
 */
function formatTranscriptAsMarkdown(transcriptText, podcastTitle = null, sourceUrl = null) {
    const finalTitle = podcastTitle ? `# 📝 ${podcastTitle}` : '# 📝 Podcast Transcript';
    const sourceSection = sourceUrl ? `\n\n---\n\n**Source:** ${sourceUrl}` : '';

    return `${finalTitle}

${transcriptText}${sourceSection}
`;
}


/**
 * 根据扩展名推断音频MIME类型
 */
function getAudioMimeType(audioPath) {
    const ext = path.extname(audioPath).toLowerCase();
    const mimeMap = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.flac': 'audio/flac',
        '.webm': 'audio/webm'
    };

    return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 获取音频真实时长（秒）
 */
async function probeAudioDuration(audioPath) {
    try {
        const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
        const { stdout } = await execAsync(command);
        const duration = Number.parseFloat((stdout || '').trim());

        return Number.isFinite(duration) ? duration : null;
    } catch (error) {
        console.warn(`⚠️ ffprobe 获取时长失败: ${error.message}`);
        return null;
    }
}

function normalizeOptionalText(value, maxLength = 500) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeHotwords(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeOptionalText(String(item), 80))
            .filter(Boolean)
            .slice(0, 20);
    }

    return String(value)
        .split(/[,\n，]/)
        .map((item) => normalizeOptionalText(item, 80))
        .filter(Boolean)
        .slice(0, 20);
}

function extractStructuredProcessError(rawValue) {
    const rawText = String(rawValue || '').trim();
    if (!rawText) {
        return '';
    }

    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
        try {
            const payload = JSON.parse(line);
            if (payload && typeof payload === 'object') {
                if (payload.error) {
                    return String(payload.error).trim();
                }
                if (payload.message) {
                    return String(payload.message).trim();
                }
            }
        } catch (_error) {
            // ignore non-JSON lines and keep looking for a structured payload
        }
    }

    return rawText;
}

function buildProcessExecutionError(error, fallbackMessage) {
    const detail = extractStructuredProcessError(error?.stdout) || extractStructuredProcessError(error?.stderr);
    if (detail) {
        return new Error(detail);
    }

    const message = String(error?.message || '').trim();
    if (!message) {
        return new Error(fallbackMessage);
    }

    return new Error(message.startsWith(fallbackMessage) ? message : `${fallbackMessage}: ${message}`);
}

const SPEAKER_LINE_PREFIX_RE = /^((?:speaker|host|guest)\s*\d*|主持人(?:\s*\d+)?|嘉宾(?:\s*\d+)?|说话人\s*\d+|[A-Za-z][A-Za-z0-9·_-]{0,23}|[\u4e00-\u9fa5·]{2,4})(?:\s*[:：]\s*|\s+-\s+)/i;
const SHORT_TRANSCRIPT_OPTIMIZATION_THRESHOLD = 80;
const OPTIMIZATION_DRIFT_REPLY_RE = /(please provide .*transcript|ready to assist|according to your requirements|请提供您需要优化|请提供.*转录文本|一旦您发送内容|按照您的要求进行|ready to help|provide the audio transcript)/i;

function stripTranscriptPresentationArtifacts(transcript) {
    return String(transcript || '')
        .replace(/^#.*$/gm, '')
        .replace(/^\*\*Source:\*\*.*$/gm, '')
        .replace(/^---$/gm, '')
        .trim();
}

function shouldSkipLlmTranscriptOptimization(rawTranscript) {
    return stripTranscriptPresentationArtifacts(rawTranscript).length < SHORT_TRANSCRIPT_OPTIMIZATION_THRESHOLD;
}

function isSuspiciousOptimizationResult(rawTranscript, optimizedTranscript) {
    const rawText = stripTranscriptPresentationArtifacts(rawTranscript);
    const optimizedText = stripTranscriptPresentationArtifacts(optimizedTranscript);

    if (!optimizedText) {
        return true;
    }

    if (OPTIMIZATION_DRIFT_REPLY_RE.test(optimizedText) && !OPTIMIZATION_DRIFT_REPLY_RE.test(rawText)) {
        return true;
    }

    if (rawText.length < 500 && optimizedText.length > rawText.length * 2 + 40) {
        return true;
    }

    return false;
}

function stripSpeakerPrefix(text) {
    return String(text || '').replace(SPEAKER_LINE_PREFIX_RE, '').trim();
}

function normalizeTranscriptForSpeakerValidation(transcript) {
    return stripTranscriptPresentationArtifacts(transcript)
        .split(/\n+/)
        .map((line) => stripSpeakerPrefix(line))
        .join(' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeTranscriptForSpeakerValidation(transcript) {
    return normalizeTranscriptForSpeakerValidation(transcript).match(/[a-z0-9]+|[\u4e00-\u9fff]/gi) || [];
}

function calculateTokenOverlapRatio(originalTokens, candidateTokens) {
    if (originalTokens.length === 0 || candidateTokens.length === 0) {
        return 0;
    }

    const candidateCounts = new Map();
    candidateTokens.forEach((token) => {
        candidateCounts.set(token, (candidateCounts.get(token) || 0) + 1);
    });

    let overlap = 0;
    originalTokens.forEach((token) => {
        const remaining = candidateCounts.get(token) || 0;
        if (remaining > 0) {
            overlap += 1;
            candidateCounts.set(token, remaining - 1);
        }
    });

    return overlap / originalTokens.length;
}

function isSpeakerRefinementSafe(originalTranscript, refinedTranscript) {
    const normalizedOriginal = normalizeTranscriptForSpeakerValidation(originalTranscript);
    const normalizedRefined = normalizeTranscriptForSpeakerValidation(refinedTranscript);

    if (!normalizedOriginal || !normalizedRefined) {
        return false;
    }

    const lengthRatio = normalizedRefined.length / normalizedOriginal.length;
    if (lengthRatio < 0.78 || lengthRatio > 1.22) {
        return false;
    }

    const tokenOverlapRatio = calculateTokenOverlapRatio(
        tokenizeTranscriptForSpeakerValidation(originalTranscript),
        tokenizeTranscriptForSpeakerValidation(refinedTranscript)
    );

    return tokenOverlapRatio >= 0.82;
}

function buildTranscriptionPrompt(language, options = {}) {
    const hotwords = normalizeHotwords(options.hotwords);
    const transcriptionContext = normalizeOptionalText(options.transcriptionContext, 500);
    const promptParts = [];

    if (language && language !== 'auto') {
        promptParts.push(`Transcribe this audio verbatim in ${language}.`);
    } else {
        promptParts.push('Transcribe this audio verbatim.');
    }

    promptParts.push('Keep the original language.');
    promptParts.push('Do not summarize.');
    promptParts.push('Do not invent timestamps.');
    promptParts.push('When speaker turns are clear, put each turn on its own paragraph and preserve consistent generic speaker labels.');
    promptParts.push('Use labels like "主持人:" / "嘉宾:" or "Speaker 1:" / "Speaker 2:" when you are confident.');
    promptParts.push('Do not hallucinate speaker names. If names are not explicit in the audio, keep labels generic.');

    if (hotwords.length > 0) {
        promptParts.push(`Prefer these spellings when they are actually heard: ${hotwords.join(', ')}.`);
    }

    if (transcriptionContext) {
        promptParts.push(`Use this context only to disambiguate terms that are actually spoken: ${transcriptionContext}.`);
    }

    return promptParts.join(' ');
}

function formatTimecode(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
    }

    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function normalizeSpeakerLabel(label) {
    return String(label || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^speaker\s*([0-9]+)$/i, 'Speaker $1')
        .replace(/^host\s*([0-9]+)$/i, 'Host $1')
        .replace(/^guest\s*([0-9]+)$/i, 'Guest $1')
        .replace(/^说话人\s*([0-9]+)$/i, '说话人 $1');
}

function getSpeakerRegistryKey(label) {
    const normalized = normalizeSpeakerLabel(label);
    if (!normalized) {
        return null;
    }

    const genericMatch = normalized.match(/^(speaker|host|guest|说话人|主持人|嘉宾)\s*([0-9]+)?$/i);
    if (genericMatch) {
        return `${genericMatch[1].toLowerCase()}:${genericMatch[2] || ''}`;
    }

    return normalized;
}

function isHostKeyword(label) {
    return /^(主持人|主播|host)$/i.test(String(label || '').trim());
}

function isGuestKeyword(label) {
    return /^(嘉宾|guest)$/i.test(String(label || '').trim());
}

function extractIntroducedSpeakerName(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return null;
    }

    const match =
        trimmed.match(/^(?:(?:hello|hi)\s*)?(?:大家好|你好|嗨)?[，,\s]*我是([A-Za-z\u4e00-\u9fa5·]{1,32})/i) ||
        trimmed.match(/^我是([A-Za-z\u4e00-\u9fa5·]{1,32})/i);

    return match ? match[1].trim() : null;
}

function buildSpeakerAliasMap(parsedBlocks) {
    const aliasMap = new Map();
    const orderedKeys = [];
    const hostKeys = [];
    const guestKeys = [];
    const genericKeys = [];

    function pushUnique(collection, value) {
        if (value && !collection.includes(value)) {
            collection.push(value);
        }
    }

    for (const block of parsedBlocks) {
        if (!block.speaker) {
            continue;
        }

        const registryKey = getSpeakerRegistryKey(block.speaker);
        if (!registryKey) {
            continue;
        }

        pushUnique(orderedKeys, registryKey);

        const introducedName = extractIntroducedSpeakerName(block.text);
        if (!introducedName) {
            continue;
        }

        if (isHostKeyword(introducedName)) {
            pushUnique(hostKeys, registryKey);
            continue;
        }

        if (isGuestKeyword(introducedName)) {
            pushUnique(guestKeys, registryKey);
            continue;
        }

        if (!aliasMap.has(registryKey)) {
            aliasMap.set(registryKey, introducedName);
        }
    }

    for (const registryKey of orderedKeys) {
        if (aliasMap.has(registryKey)) {
            continue;
        }

        if (/^(host:|主持人:)/i.test(registryKey)) {
            pushUnique(hostKeys, registryKey);
            continue;
        }

        if (/^(guest:|嘉宾:)/i.test(registryKey)) {
            pushUnique(guestKeys, registryKey);
            continue;
        }

        pushUnique(genericKeys, registryKey);
    }

    hostKeys.forEach((registryKey, index) => {
        aliasMap.set(registryKey, hostKeys.length === 1 ? '主持人' : `主持人 ${index + 1}`);
    });

    guestKeys.forEach((registryKey, index) => {
        aliasMap.set(registryKey, guestKeys.length === 1 ? '嘉宾' : `嘉宾 ${index + 1}`);
    });

    const namedSpeakerCount = [...aliasMap.keys()].filter((registryKey) =>
        !hostKeys.includes(registryKey) && !guestKeys.includes(registryKey)
    ).length;

    if (genericKeys.length > 0 && namedSpeakerCount >= 1) {
        genericKeys.forEach((registryKey, index) => {
            aliasMap.set(registryKey, genericKeys.length === 1 ? '主持人' : `主持人 ${index + 1}`);
        });
        return aliasMap;
    }

    genericKeys.forEach((registryKey, index) => {
        if (!aliasMap.has(registryKey)) {
            aliasMap.set(registryKey, `说话人 ${index + 1}`);
        }
    });

    return aliasMap;
}

function extractSpeakerFromBlock(block) {
    const speakerMatch = block.match(SPEAKER_LINE_PREFIX_RE);
    if (!speakerMatch) {
        return { speaker: null, text: block.trim() };
    }

    const speaker = normalizeSpeakerLabel(speakerMatch[1]);
    const text = block.slice(speakerMatch[0].length).trim();
    return {
        speaker,
        text: text || block.trim()
    };
}

function prepareTranscriptBlocks(transcript) {
    const cleanedTranscript = stripTranscriptPresentationArtifacts(transcript);

    if (!cleanedTranscript) {
        return {
            cleanedTranscript: '',
            normalizedBlocks: []
        };
    }

    const blocks = splitTranscriptIntoTurnBlocks(cleanedTranscript);
    const baseBlocks = (blocks.length > 0 ? blocks : [cleanedTranscript]).map((rawBlock) => {
        const extracted = extractSpeakerFromBlock(rawBlock);
        return {
            rawBlock: rawBlock.trim(),
            speaker: extracted.speaker,
            text: extracted.text
        };
    });
    const aliasMap = buildSpeakerAliasMap(baseBlocks);

    return {
        cleanedTranscript,
        normalizedBlocks: baseBlocks.map((block) => {
            const registryKey = getSpeakerRegistryKey(block.speaker);
            const speaker = registryKey ? aliasMap.get(registryKey) || block.speaker : null;
            return {
                ...block,
                speaker,
                normalizedBlock: speaker ? `${speaker}：${block.text}` : block.text
            };
        })
    };
}

function detectConversationActors(blocks) {
    const discoveredNames = [];

    for (const block of blocks) {
        const introMatch =
            block.match(/^(?:嗨|你好|大家好|hello|hi)[，,\s]*我是([A-Za-z\u4e00-\u9fa5·]{1,24})/i) ||
            block.match(/^我是([A-Za-z\u4e00-\u9fa5·]{1,24})/i);

        if (!introMatch) {
            continue;
        }

        const candidate = introMatch[1].trim();
        if (!candidate || discoveredNames.includes(candidate)) {
            continue;
        }

        discoveredNames.push(candidate);
        if (discoveredNames.length >= 2) {
            break;
        }
    }

    return {
        hostSpeaker: discoveredNames[0] || '主持人',
        guestSpeaker: discoveredNames[1] || '嘉宾'
    };
}

function splitTranscriptIntoTurnBlocks(cleanedTranscript) {
    return cleanedTranscript
        .split(/\n{2,}/)
        .flatMap((paragraph) =>
            paragraph
                .split(/\n+/)
                .map((line) => line.trim())
                .filter(Boolean)
        );
}

function looksLikeQuestion(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return false;
    }

    if (/[？?]\s*$/.test(trimmed)) {
        return true;
    }

    return /^(请问|所以|那么|那|最后一个问题|最后|有没有|为什么|可不可以|你觉得|是不是|能不能|那我们来)/.test(trimmed);
}

function inferSpeakerForTurn(text, context) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return null;
    }

    const introMatch =
        trimmed.match(/^(?:嗨|你好|大家好|hello|hi)[，,\s]*我是([A-Za-z\u4e00-\u9fa5·]{1,24})/i) ||
        trimmed.match(/^我是([A-Za-z\u4e00-\u9fa5·]{1,24})/i);

    if (introMatch) {
        const speakerName = introMatch[1].trim();
        if (speakerName === context.hostSpeaker || speakerName === context.guestSpeaker) {
            return speakerName;
        }

        return context.seenSpeakerNames.size === 0 ? context.hostSpeaker : context.guestSpeaker;
    }

    if (context.index === 0 && /欢迎收听|我们关注|今天请到了/.test(trimmed)) {
        return context.hostSpeaker;
    }

    if (/你好|欢迎来到|请问/.test(trimmed) && trimmed.includes(context.guestSpeaker)) {
        return context.hostSpeaker;
    }

    const isQuestion = looksLikeQuestion(trimmed);
    if (isQuestion) {
        return context.hostSpeaker;
    }

    if (context.previousWasQuestion && context.previousSpeaker) {
        return context.previousSpeaker === context.hostSpeaker ? context.guestSpeaker : context.hostSpeaker;
    }

    if (/^(好，那|那我们|我们前面|那比如|我在想|其实有很长一段时间|最后一个问题|大家今天可以)/.test(trimmed)) {
        return context.hostSpeaker;
    }

    if (/^(对|会|有|没有|当然|就是|我们|我|一方面|但我|首先|其次|最后|这个|平头哥)/.test(trimmed) && context.previousSpeaker) {
        return context.previousSpeaker === context.hostSpeaker ? context.guestSpeaker : context.previousSpeaker;
    }

    return context.previousSpeaker || null;
}

function buildStructuredTranscript(transcript, audioDuration = null) {
    const { cleanedTranscript, normalizedBlocks } = prepareTranscriptBlocks(transcript);

    if (!cleanedTranscript) {
        return {
            segments: [],
            timingMode: 'none',
            speakerMode: 'none'
        };
    }

    const contextBlocks = normalizedBlocks.map((block) => block.text);
    const { hostSpeaker, guestSpeaker } = detectConversationActors(contextBlocks);
    const seenSpeakerNames = new Set();
    let previousSpeaker = null;
    let previousWasQuestion = false;
    const hasExplicitSpeakers = normalizedBlocks.some((block) => Boolean(block.speaker));

    const parsedBlocks = normalizedBlocks.map((block, index) => {
        const inferredSpeaker = block.speaker || (!hasExplicitSpeakers ? inferSpeakerForTurn(block.text, {
            index,
            hostSpeaker,
            guestSpeaker,
            previousSpeaker,
            previousWasQuestion,
            seenSpeakerNames
        }) : null);

        if (inferredSpeaker) {
            seenSpeakerNames.add(inferredSpeaker);
        }

        previousSpeaker = inferredSpeaker || previousSpeaker;
        previousWasQuestion = looksLikeQuestion(block.text);

        return {
            ...block,
            speaker: inferredSpeaker
        };
    });

    const totalWeight = parsedBlocks.reduce((sum, block) => sum + Math.max(block.text.length, 1), 0);
    const hasEstimatedTimings = Number.isFinite(audioDuration) && audioDuration > 0;
    const hasSpeakers = parsedBlocks.some((block) => Boolean(block.speaker));
    let cursor = 0;

    const segments = parsedBlocks.map((block, index) => {
        const weight = Math.max(block.text.length, 1);
        const startSec = hasEstimatedTimings ? cursor : null;
        const durationShare = hasEstimatedTimings ? (audioDuration * weight) / totalWeight : null;
        const endSec = hasEstimatedTimings ? Math.min(audioDuration, cursor + durationShare) : null;
        if (hasEstimatedTimings) {
            cursor = endSec;
        }

        return {
            id: `segment_${index + 1}`,
            index,
            speaker: block.speaker,
            text: block.text,
            startSec: startSec !== null ? Number(startSec.toFixed(1)) : null,
            endSec: endSec !== null ? Number(endSec.toFixed(1)) : null,
            timeLabel: startSec !== null ? formatTimecode(startSec) : null
        };
    });

    return {
        segments,
        timingMode: hasEstimatedTimings ? 'estimated' : 'none',
        speakerMode: hasSpeakers ? 'explicit-or-inferred' : 'none'
    };
}

function getDisplaySpeakerLabel(rawSpeaker, speakerRegistry) {
    const normalized = String(rawSpeaker || '').trim();
    if (!normalized) {
        return null;
    }

    if (/^(speaker|host|guest|说话人|主持人|嘉宾)\b/i.test(normalized)) {
        return normalizeSpeakerLabel(normalized);
    }

    if (!speakerRegistry.has(normalized)) {
        speakerRegistry.set(normalized, `Speaker ${speakerRegistry.size + 1}`);
    }

    return speakerRegistry.get(normalized);
}

function buildStructuredTranscriptFromSegments(rawSegments = [], options = {}) {
    const speakerRegistry = new Map();
    const segments = Array.isArray(rawSegments)
        ? rawSegments
            .map((segment, index) => {
                const text = String(segment?.text || '').trim();
                if (!text) {
                    return null;
                }

                const startSec = Number.isFinite(Number(segment?.start)) ? Number(segment.start) : null;
                const endSec = Number.isFinite(Number(segment?.end)) ? Number(segment.end) : null;

                return {
                    id: `segment_${index + 1}`,
                    index,
                    speaker: getDisplaySpeakerLabel(segment?.speaker, speakerRegistry),
                    text,
                    startSec: startSec !== null ? Number(startSec.toFixed(1)) : null,
                    endSec: endSec !== null ? Number(endSec.toFixed(1)) : null,
                    timeLabel: startSec !== null ? formatTimecode(startSec) : null
                };
            })
            .filter(Boolean)
        : [];

    return {
        segments,
        timingMode: options.timingMode || 'aligned',
        speakerMode: options.speakerMode || (segments.some((segment) => Boolean(segment.speaker)) ? 'explicit' : 'none')
    };
}

function isGenericSpeakerLabel(label) {
    const normalized = normalizeSpeakerLabel(label);
    return /^(speaker|host|guest|说话人|主持人|嘉宾)\s*([0-9]+)?$/i.test(normalized);
}

function sanitizeAttributedSpeakerName(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[。！!？?,，;；:：]+$/g, '')
        .replace(/^\s*(?:我是|我叫|名字是|I am|I'm|This is)\s+/i, '')
        .trim();

    if (!normalized || isGenericSpeakerLabel(normalized)) {
        return '';
    }

    if (normalized.length < 2 || normalized.length > 40) {
        return '';
    }

    if (!/^[A-Za-z\u4e00-\u9fa5·' ._-]+$/.test(normalized)) {
        return '';
    }

    return normalized;
}

function includesSpeakerEvidence(haystack, needle) {
    const source = String(haystack || '').trim();
    const candidate = String(needle || '').trim();
    if (!source || !candidate) {
        return false;
    }

    return source.includes(candidate) || source.toLowerCase().includes(candidate.toLowerCase());
}

function buildHeuristicSpeakerNameMap(structuredTranscript) {
    const segments = Array.isArray(structuredTranscript?.segments) ? structuredTranscript.segments : [];
    const candidatesBySpeaker = new Map();

    for (const segment of segments) {
        const speaker = normalizeSpeakerLabel(segment?.speaker);
        if (!speaker || !isGenericSpeakerLabel(speaker)) {
            continue;
        }

        const introducedName = sanitizeAttributedSpeakerName(extractIntroducedSpeakerName(segment?.text));
        if (!introducedName || isHostKeyword(introducedName) || isGuestKeyword(introducedName)) {
            continue;
        }

        if (!candidatesBySpeaker.has(speaker)) {
            candidatesBySpeaker.set(speaker, []);
        }

        const speakerCandidates = candidatesBySpeaker.get(speaker);
        if (!speakerCandidates.includes(introducedName)) {
            speakerCandidates.push(introducedName);
        }
    }

    const usedNames = new Set();
    const resolvedMap = {};
    for (const [speaker, candidates] of candidatesBySpeaker.entries()) {
        if (candidates.length !== 1) {
            continue;
        }

        const [candidate] = candidates;
        if (usedNames.has(candidate)) {
            continue;
        }

        usedNames.add(candidate);
        resolvedMap[speaker] = candidate;
    }

    return resolvedMap;
}

function extractJsonPayload(text) {
    const rawText = String(text || '').trim();
    if (!rawText) {
        return null;
    }

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = fencedMatch ? [fencedMatch[1], rawText] : [rawText];

    for (const candidate of candidates) {
        const trimmed = String(candidate || '').trim();
        if (!trimmed) {
            continue;
        }

        try {
            return JSON.parse(trimmed);
        } catch (_error) {
            const firstBrace = trimmed.indexOf('{');
            const lastBrace = trimmed.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                try {
                    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
                } catch (_innerError) {
                    // keep trying
                }
            }
        }
    }

    return null;
}

function buildSpeakerAttributionEvidence(structuredTranscript, maxChars = 5000) {
    const segments = Array.isArray(structuredTranscript?.segments) ? structuredTranscript.segments : [];
    const selectedLines = [];
    const seenLines = new Set();
    const perSpeakerCounts = new Map();
    let usedChars = 0;

    const prioritizedSegments = [
        ...segments.filter((segment) => extractIntroducedSpeakerName(segment?.text)),
        ...segments
    ];

    for (const segment of prioritizedSegments) {
        const speaker = normalizeSpeakerLabel(segment?.speaker);
        if (!speaker || !isGenericSpeakerLabel(speaker)) {
            continue;
        }

        const seenCount = perSpeakerCounts.get(speaker) || 0;
        if (seenCount >= 4) {
            continue;
        }

        const text = String(segment?.text || '').trim();
        if (!text) {
            continue;
        }

        const line = `${speaker}${segment?.timeLabel ? ` [${segment.timeLabel}]` : ''}: ${text}`;
        if (seenLines.has(line)) {
            continue;
        }
        if (usedChars + line.length > maxChars && selectedLines.length > 0) {
            break;
        }

        selectedLines.push(line);
        seenLines.add(line);
        perSpeakerCounts.set(speaker, seenCount + 1);
        usedChars += line.length + 2;
    }

    return selectedLines.join('\n\n');
}

function parseSpeakerAttributionMap(rawContent, unresolvedSpeakers, evidenceCorpus) {
    const payload = extractJsonPayload(rawContent);
    if (!payload || typeof payload !== 'object') {
        return {};
    }

    const rawMap = payload.speaker_map && typeof payload.speaker_map === 'object'
        ? payload.speaker_map
        : payload;
    const allowedSpeakers = new Set(unresolvedSpeakers.map((speaker) => normalizeSpeakerLabel(speaker)));
    const usedNames = new Set();
    const resolvedMap = {};

    for (const [rawSpeaker, rawName] of Object.entries(rawMap)) {
        const speaker = normalizeSpeakerLabel(rawSpeaker);
        if (!allowedSpeakers.has(speaker)) {
            continue;
        }

        const candidateName = sanitizeAttributedSpeakerName(rawName);
        if (!candidateName || usedNames.has(candidateName)) {
            continue;
        }

        if (!includesSpeakerEvidence(evidenceCorpus, candidateName)) {
            continue;
        }

        usedNames.add(candidateName);
        resolvedMap[speaker] = candidateName;
    }

    return resolvedMap;
}

function applySpeakerNameMap(structuredTranscript, speakerNameMap) {
    if (!structuredTranscript || !speakerNameMap || Object.keys(speakerNameMap).length === 0) {
        return structuredTranscript;
    }

    const segments = Array.isArray(structuredTranscript.segments) ? structuredTranscript.segments : [];
    let changed = false;
    const nextSegments = segments.map((segment) => {
        const normalizedSpeaker = normalizeSpeakerLabel(segment?.speaker);
        const mappedSpeaker = normalizedSpeaker ? speakerNameMap[normalizedSpeaker] : null;
        if (!mappedSpeaker || mappedSpeaker === segment?.speaker) {
            return segment;
        }

        changed = true;
        return {
            ...segment,
            speaker: mappedSpeaker
        };
    });

    if (!changed) {
        return structuredTranscript;
    }

    return {
        ...structuredTranscript,
        segments: nextSegments
    };
}

async function attributeSpeakerNamesForStructuredTranscript(structuredTranscript, options = {}) {
    const segments = Array.isArray(structuredTranscript?.segments) ? structuredTranscript.segments : [];
    if (segments.length === 0) {
        return structuredTranscript;
    }

    const genericSpeakers = [...new Set(
        segments
            .map((segment) => normalizeSpeakerLabel(segment?.speaker))
            .filter((speaker) => speaker && isGenericSpeakerLabel(speaker))
    )];
    if (genericSpeakers.length === 0) {
        return structuredTranscript;
    }

    const heuristicMap = buildHeuristicSpeakerNameMap(structuredTranscript);
    let speakerNameMap = { ...heuristicMap };
    const unresolvedSpeakers = genericSpeakers.filter((speaker) => !speakerNameMap[speaker]);
    if (unresolvedSpeakers.length === 0 || !AI_API_KEY) {
        return applySpeakerNameMap(structuredTranscript, speakerNameMap);
    }

    const transcriptLanguage = options.transcriptLanguage === 'zh' ? 'zh' : 'en';
    const evidenceText = buildSpeakerAttributionEvidence(structuredTranscript);
    if (!evidenceText) {
        return applySpeakerNameMap(structuredTranscript, speakerNameMap);
    }

    const metadataLines = [
        options.podcastTitle ? `Podcast title: ${options.podcastTitle}` : '',
        options.originalUrl ? `Source URL: ${options.originalUrl}` : '',
        `Unresolved speaker labels: ${unresolvedSpeakers.join(', ')}`
    ].filter(Boolean);
    const evidenceCorpus = [
        options.podcastTitle || '',
        options.rawTranscript || '',
        evidenceText
    ].join('\n');
    const prompt = transcriptLanguage === 'zh'
        ? `你要做的唯一任务，是把已经完成 diarization 的通用说话人标签映射成真实人名。

严格要求：
1. 只能使用下面给出的标题、链接和转录证据，不能使用外部知识。
2. 只有在人名明确出现在证据里时，才能映射为真实人名。
3. 如果不确定，就返回 null，不要猜。
4. 不要改写文本，不要输出解释。
5. 只返回 JSON，格式必须是 {"speaker_map":{"Speaker 1":"张三","Speaker 2":null}}

元信息：
${metadataLines.join('\n')}

转录证据：
${evidenceText}`
        : `Your only task is to map existing diarized generic speaker labels to real person names.

Strict requirements:
1. Use only the title, URL, and transcript evidence below. Do not use outside knowledge.
2. Assign a real name only when that name is explicitly present in the evidence.
3. If uncertain, return null for that speaker instead of guessing.
4. Do not rewrite the transcript and do not add explanations.
5. Return JSON only, in exactly this shape: {"speaker_map":{"Speaker 1":"Jane Doe","Speaker 2":null}}

Metadata:
${metadataLines.join('\n')}

Transcript evidence:
${evidenceText}`;

    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: AI_SPEAKER_MODEL,
            messages: [
                {
                    role: 'system',
                    content: transcriptLanguage === 'zh'
                        ? '你是一个严格的 speaker name attribution 助手，只能输出 JSON 映射，不得猜测。'
                        : 'You are a strict speaker-name attribution assistant. Return JSON only and never guess.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0,
            max_tokens: 500
        });

        const content = String(response.choices?.[0]?.message?.content || '').trim();
        const llmMap = parseSpeakerAttributionMap(content, unresolvedSpeakers, evidenceCorpus);
        speakerNameMap = {
            ...speakerNameMap,
            ...llmMap
        };
    } catch (error) {
        console.warn(`⚠️ 说话人命名归因失败，保留通用标签: ${error.message}`);
    }

    return applySpeakerNameMap(structuredTranscript, speakerNameMap);
}

function renderStructuredTranscript(structuredTranscript) {
    const segments = Array.isArray(structuredTranscript?.segments) ? structuredTranscript.segments : [];

    return segments
        .map((segment) => {
            const text = String(segment?.text || '').trim();
            if (!text) {
                return '';
            }

            const speaker = String(segment?.speaker || '').trim();
            return speaker ? `${speaker}: ${text}` : text;
        })
        .filter(Boolean)
        .join('\n\n')
        .trim();
}

function hasNativeStructuredTranscript(structuredTranscript) {
    return Array.isArray(structuredTranscript?.segments)
        && structuredTranscript.segments.length > 0
        && structuredTranscript.speakerMode === 'diarized';
}

function normalizeTranscriptSpeakerLabels(transcript) {
    const { cleanedTranscript, normalizedBlocks } = prepareTranscriptBlocks(transcript);

    if (!cleanedTranscript) {
        return '';
    }

    return normalizedBlocks.map((block) => block.normalizedBlock).join('\n\n');
}

const AI_API_KEY = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
const AI_BASE_URL = process.env.GEMINI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
const AI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || process.env.AI_FAST_MODEL || 'gemini-3.1-flash-lite-preview';
const AI_SPEAKER_MODEL = process.env.GEMINI_SPEAKER_MODEL || process.env.AI_SPEAKER_MODEL || AI_FAST_MODEL;
const AI_DEFAULT_MODEL = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-3.1-flash-lite-preview';
const AI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || process.env.AI_SUMMARY_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.1-flash-lite-preview';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium';
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || 'cpu';
const WHISPER_COMPUTE_TYPE = process.env.WHISPER_COMPUTE_TYPE || 'int8';
const WHISPERX_MODEL = process.env.WHISPERX_MODEL || WHISPER_MODEL;
const WHISPERX_DEVICE = process.env.WHISPERX_DEVICE || WHISPER_DEVICE;
const WHISPERX_COMPUTE_TYPE = process.env.WHISPERX_COMPUTE_TYPE || WHISPER_COMPUTE_TYPE;
const WHISPERX_MODEL_DIR = process.env.WHISPERX_MODEL_DIR || path.join(__dirname, '..', '..', 'models');
const WHISPERX_DIARIZATION_MODEL = process.env.PYANNOTE_DIARIZATION_MODEL
    || process.env.WHISPERX_DIARIZATION_MODEL
    || 'pyannote/speaker-diarization-community-1';
const WHISPERX_THREADS = Math.max(1, Number.parseInt(process.env.WHISPERX_THREADS || '4', 10) || 4);
const WHISPERX_BATCH_SIZE = Math.max(
    1,
    Number.parseInt(process.env.WHISPERX_BATCH_SIZE || (WHISPERX_DEVICE === 'cuda' ? '16' : '8'), 10) || 8
);
const QWEN3_ASR_MODEL = process.env.QWEN3_ASR_MODEL || 'qwen3-asr-flash';
const FUN_ASR_REALTIME_MODEL = process.env.FUN_ASR_REALTIME_MODEL || process.env.DASHSCOPE_ASR_MODEL || 'fun-asr-realtime-2026-02-28';
const FUN_ASR_FILE_MODEL = process.env.FUN_ASR_FILE_MODEL || 'fun-asr';
const DASHSCOPE_API_ROOT = process.env.DASHSCOPE_API_ROOT || 'https://dashscope.aliyuncs.com';
const GEMINI_TRANSCRIBE_FALLBACK_MODELS = (process.env.GEMINI_TRANSCRIBE_FALLBACK_MODELS || `${AI_DEFAULT_MODEL},gemini-2.5-flash`)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const GEMINI_TRANSCRIBE_MODEL_CHAIN = [...new Set([GEMINI_TRANSCRIBE_MODEL, ...GEMINI_TRANSCRIBE_FALLBACK_MODELS])];
const SUPPORTED_ASR_BACKENDS = ['auto', 'fun_asr_file_diarization', 'qwen3_asr', 'gemini_audio', 'fun_asr_realtime', 'whisperx_local', 'whisper_local'];
const ASR_AUTO_BACKEND_ORDER = ['fun_asr_file_diarization', 'qwen3_asr', 'gemini_audio', 'fun_asr_realtime', 'whisperx_local', 'whisper_local'];
const commandAvailabilityCache = new Map();
let openaiClient = null;
let geminiClient = null;

console.log(`🎤 ASR 后端支持: ${SUPPORTED_ASR_BACKENDS.join(', ')}`);
console.log(`🤖 AI兼容接口: ${AI_BASE_URL}`);
console.log(`🤖 Gemini模型: fast=${AI_FAST_MODEL}, speaker=${AI_SPEAKER_MODEL}, default=${AI_DEFAULT_MODEL}`);
console.log(`🤖 Gemini转录模型: ${GEMINI_TRANSCRIBE_MODEL_CHAIN.join(' -> ')}, summary=${AI_SUMMARY_MODEL}`);
console.log(`🎧 Qwen3 ASR 模型: ${QWEN3_ASR_MODEL}`);
console.log(`🎧 Fun-ASR 实时模型: ${FUN_ASR_REALTIME_MODEL}`);
console.log(`🎧 Fun-ASR 录音文件模型: ${FUN_ASR_FILE_MODEL}`);
console.log(`🌐 DashScope API Root: ${DASHSCOPE_API_ROOT}`);
console.log(`🗣️ Local Whisper 默认配置: model=${WHISPER_MODEL}, device=${WHISPER_DEVICE}, compute=${WHISPER_COMPUTE_TYPE}`);
console.log(`🧩 WhisperX 说话人分离配置: model=${WHISPERX_MODEL}, device=${WHISPERX_DEVICE}, compute=${WHISPERX_COMPUTE_TYPE}, diarization=${WHISPERX_DIARIZATION_MODEL}`);

function getOpenAIClient() {
    if (!AI_API_KEY) {
        throw new Error('缺少 GEMINI_API_KEY 或 OPENAI_API_KEY，无法使用文本优化/总结模型');
    }

    if (!openaiClient) {
        openaiClient = new OpenAI({
            apiKey: AI_API_KEY,
            baseURL: AI_BASE_URL,
            timeout: 900000,
            maxRetries: 0
        });
    }

    return openaiClient;
}

function getGeminiClient() {
    if (!AI_API_KEY) {
        throw new Error('缺少 GEMINI_API_KEY 或 OPENAI_API_KEY，无法使用 Gemini Audio');
    }

    if (!geminiClient) {
        geminiClient = new GoogleGenAI({ apiKey: AI_API_KEY });
    }

    return geminiClient;
}

function isTransientGeminiError(error) {
    const message = String(error?.message || '');
    const status = Number(error?.status || error?.code || 0);

    return status === 429 || status === 500 || status === 503
        || message.includes('"status":"UNAVAILABLE"')
        || message.includes('"status":"RESOURCE_EXHAUSTED"')
        || message.includes('"code":503')
        || message.includes('"code":429');
}

function normalizeAsrBackend(backend) {
    const normalized = String(backend || 'auto').trim().toLowerCase();
    if (normalized === 'qwen_asr') {
        return 'fun_asr_realtime';
    }

    return SUPPORTED_ASR_BACKENDS.includes(normalized) ? normalized : null;
}

function escapeShellArg(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function getWhisperScriptPath() {
    return path.join(__dirname, '..', 'whisper_transcribe.py');
}

function getWhisperXScriptPath() {
    return path.join(__dirname, '..', 'whisperx_transcribe.py');
}

function getQwen3AsrScriptPath() {
    return path.join(__dirname, '..', 'qwen3_asr.py');
}

function getDashScopeAsrScriptPath() {
    return path.join(__dirname, '..', 'dashscope_asr.py');
}

function getFunAsrFileDiarizationScriptPath() {
    return path.join(__dirname, '..', 'fun_asr_file_diarization.py');
}

function getWhisperPythonBin() {
    if (process.env.WHISPER_PYTHON_BIN) {
        return process.env.WHISPER_PYTHON_BIN;
    }

    const repoPython = path.join(__dirname, '..', '..', 'venv', 'bin', 'python');
    if (fs.existsSync(repoPython)) {
        return repoPython;
    }

    return 'python3';
}

function getPyannoteToken() {
    return process.env.PYANNOTE_TOKEN
        || process.env.HF_TOKEN
        || process.env.HUGGINGFACE_TOKEN
        || process.env.HUGGING_FACE_HUB_TOKEN
        || '';
}

async function isCommandAvailable(command) {
    const executable = String(command || '').trim().split(/\s+/)[0];
    if (!executable) {
        return false;
    }

    if (commandAvailabilityCache.has(executable)) {
        return commandAvailabilityCache.get(executable);
    }

    try {
        await execAsync(`command -v ${escapeShellArg(executable)}`, { timeout: 10000 });
        commandAvailabilityCache.set(executable, true);
        return true;
    } catch (_error) {
        commandAvailabilityCache.set(executable, false);
        return false;
    }
}

async function getBackendAvailability(backend, transcriptionOptions = {}) {
    switch (backend) {
        case 'qwen3_asr':
            if (!process.env.DASHSCOPE_API_KEY) {
                return { available: false, reason: '缺少 DASHSCOPE_API_KEY' };
            }
            if (!fs.existsSync(getQwen3AsrScriptPath())) {
                return { available: false, reason: '缺少本地 qwen3_asr.py 脚本' };
            }
            if (!await isCommandAvailable(getWhisperPythonBin())) {
                return { available: false, reason: `未找到 Python 可执行文件: ${getWhisperPythonBin()}` };
            }
            return { available: true };
        case 'fun_asr_realtime':
            if (!process.env.DASHSCOPE_API_KEY) {
                return { available: false, reason: '缺少 DASHSCOPE_API_KEY' };
            }
            if (!fs.existsSync(getDashScopeAsrScriptPath())) {
                return { available: false, reason: '缺少 Fun-ASR 实时转录脚本' };
            }
            if (!await isCommandAvailable(getWhisperPythonBin())) {
                return { available: false, reason: `未找到 Python 可执行文件: ${getWhisperPythonBin()}` };
            }
            return { available: true };
        case 'fun_asr_file_diarization':
            if (!process.env.DASHSCOPE_API_KEY) {
                return { available: false, reason: '缺少 DASHSCOPE_API_KEY' };
            }
            if (!transcriptionOptions.sourceAudioUrl) {
                return { available: false, reason: '需要公网可访问的音频直链；本地文件和仅页面 URL 不支持' };
            }
            if (!fs.existsSync(getFunAsrFileDiarizationScriptPath())) {
                return { available: false, reason: '缺少 Fun-ASR 录音文件脚本' };
            }
            if (!await isCommandAvailable(getWhisperPythonBin())) {
                return { available: false, reason: `未找到 Python 可执行文件: ${getWhisperPythonBin()}` };
            }
            return { available: true };
        case 'gemini_audio':
            if (!AI_API_KEY) {
                return { available: false, reason: '缺少 GEMINI_API_KEY 或 OPENAI_API_KEY' };
            }
            return { available: true };
        case 'whisperx_local':
            if (!fs.existsSync(getWhisperXScriptPath())) {
                return { available: false, reason: '缺少本地 whisperx_transcribe.py 脚本' };
            }
            if (!await isCommandAvailable(getWhisperPythonBin())) {
                return { available: false, reason: `未找到 Python 可执行文件: ${getWhisperPythonBin()}` };
            }
            if (!getPyannoteToken()) {
                return { available: false, reason: '缺少 PYANNOTE_TOKEN / HF_TOKEN，无法加载 pyannote speaker diarization 模型' };
            }
            return { available: true };
        case 'whisper_local':
            if (!fs.existsSync(getWhisperScriptPath())) {
                return { available: false, reason: '缺少本地 whisper_transcribe.py 脚本' };
            }
            if (!await isCommandAvailable(getWhisperPythonBin())) {
                return { available: false, reason: `未找到 Python 可执行文件: ${getWhisperPythonBin()}` };
            }
            return { available: true };
        default:
            return { available: false, reason: `不支持的 ASR backend: ${backend}` };
    }
}

function buildQwenContext(language, options = {}) {
    const hotwords = normalizeHotwords(options.hotwords);
    const transcriptionContext = normalizeOptionalText(options.transcriptionContext, 500);
    const contextParts = [];

    if (language && language !== 'auto') {
        contextParts.push(`The spoken language is likely ${language}.`);
    }

    if (hotwords.length > 0) {
        contextParts.push(`Prefer these spellings when heard: ${hotwords.join(', ')}.`);
    }

    if (transcriptionContext) {
        contextParts.push(`Disambiguation context: ${transcriptionContext}`);
    }

    return contextParts.join(' ');
}

async function transcribeAudioWithWhisperLocal(audioPath, language = null, transcriptionOptions = {}) {
    const pythonBin = getWhisperPythonBin();
    const scriptPath = getWhisperScriptPath();
    const args = [
        scriptPath,
        audioPath,
        '--model',
        WHISPER_MODEL,
        '--device',
        WHISPER_DEVICE,
        '--compute-type',
        WHISPER_COMPUTE_TYPE
    ];

    if (language && language !== 'auto') {
        args.push('--language', language);
    }

    const prompt = buildTranscriptionPrompt(language, transcriptionOptions);
    if (prompt) {
        args.push('--prompt', prompt);
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(pythonBin, args, {
            timeout: 60 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 20
        }));
    } catch (error) {
        throw buildProcessExecutionError(error, 'Whisper 本地转录失败');
    }
    const result = JSON.parse(stdout);

    if (!result?.success) {
        throw new Error(result?.error || 'Whisper 本地转录失败');
    }

    return {
        text: String(result.text || '').trim(),
        language: result.language || null,
        audioDuration: Number.isFinite(result.duration) ? result.duration : await probeAudioDuration(audioPath),
        backendUsed: 'whisper_local'
    };
}

async function transcribeAudioWithWhisperXLocal(audioPath, language = null, transcriptionOptions = {}) {
    const pythonBin = getWhisperPythonBin();
    const scriptPath = getWhisperXScriptPath();
    const args = [
        scriptPath,
        audioPath,
        '--model',
        WHISPERX_MODEL,
        '--device',
        WHISPERX_DEVICE,
        '--compute-type',
        WHISPERX_COMPUTE_TYPE,
        '--model-dir',
        WHISPERX_MODEL_DIR,
        '--diarization-model',
        WHISPERX_DIARIZATION_MODEL,
        '--batch-size',
        String(WHISPERX_BATCH_SIZE),
        '--threads',
        String(WHISPERX_THREADS)
    ];

    if (language && language !== 'auto') {
        args.push('--language', language);
    }

    const prompt = buildTranscriptionPrompt(language, transcriptionOptions);
    if (prompt) {
        args.push('--prompt', prompt);
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(pythonBin, args, {
            timeout: 2 * 60 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 40,
            env: {
                ...process.env,
                PYANNOTE_TOKEN: getPyannoteToken()
            }
        }));
    } catch (error) {
        throw buildProcessExecutionError(error, 'WhisperX 本地转录失败');
    }

    const result = JSON.parse(stdout);
    if (!result?.success) {
        throw new Error(result?.error || 'WhisperX 本地转录失败');
    }

    const structuredTranscript = buildStructuredTranscriptFromSegments(result.segments, {
        timingMode: result.timing_mode || 'aligned',
        speakerMode: result.speaker_mode || 'diarized'
    });
    const transcript = String(result.text || '').trim() || renderStructuredTranscript(structuredTranscript);

    if (!transcript) {
        throw new Error('WhisperX 返回了空转录结果');
    }

    return {
        text: transcript,
        language: result.language || null,
        audioDuration: Number.isFinite(result.duration) ? result.duration : await probeAudioDuration(audioPath),
        backendUsed: 'whisperx_local',
        structuredTranscript
    };
}

async function transcribeAudioWithQwen3Asr(audioPath, language = null, transcriptionOptions = {}) {
    const pythonBin = getWhisperPythonBin();
    const scriptPath = getQwen3AsrScriptPath();
    const args = [
        scriptPath,
        audioPath,
        '--model',
        QWEN3_ASR_MODEL,
        '--num-threads',
        '4',
        '--vad-segment-threshold',
        '120'
    ];

    const context = buildQwenContext(language, transcriptionOptions);
    if (context) {
        args.push('--context', context);
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(pythonBin, args, {
            timeout: 2 * 60 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 40,
            env: {
                ...process.env,
                DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY
            }
        }));
    } catch (error) {
        throw buildProcessExecutionError(error, 'Qwen3-ASR 转录失败');
    }

    const result = JSON.parse(stdout);
    if (!result?.success) {
        throw new Error(result?.error || 'Qwen3-ASR 转录失败');
    }

    const transcript = String(result.text || '').trim();
    if (!transcript) {
        throw new Error('Qwen3-ASR 返回了空转录结果');
    }

    return {
        text: transcript,
        language: result.language || null,
        audioDuration: Number.isFinite(result.duration) ? result.duration : await probeAudioDuration(audioPath),
        backendUsed: 'qwen3_asr'
    };
}

async function transcribeAudioWithFunAsrRealtime(audioPath, language = null, transcriptionOptions = {}) {
    const pythonBin = getWhisperPythonBin();
    const scriptPath = getDashScopeAsrScriptPath();
    const args = [scriptPath, audioPath, '--model', FUN_ASR_REALTIME_MODEL];

    if (language && language !== 'auto') {
        args.push('--language', language);
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(pythonBin, args, {
            timeout: 60 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 20,
            env: {
                ...process.env,
                DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY
            }
        }));
    } catch (error) {
        throw buildProcessExecutionError(error, 'DashScope ASR 转录失败');
    }

    const result = JSON.parse(stdout);
    if (!result?.success) {
        throw new Error(result?.error || 'DashScope ASR 转录失败');
    }

    const transcript = String(result.text || '').trim();
    if (!transcript) {
        throw new Error('DashScope ASR 返回了空转录结果');
    }

    return {
        text: transcript,
        language: result.language || null,
        audioDuration: await probeAudioDuration(audioPath),
        backendUsed: 'fun_asr_realtime'
    };
}

async function transcribeAudioWithFunAsrFileDiarization(_audioPath, language = null, transcriptionOptions = {}) {
    const sourceAudioUrl = String(transcriptionOptions.sourceAudioUrl || '').trim();
    if (!sourceAudioUrl) {
        throw new Error('Fun-ASR 录音文件识别需要公网可访问的音频直链');
    }

    const pythonBin = getWhisperPythonBin();
    const scriptPath = getFunAsrFileDiarizationScriptPath();
    const args = [
        scriptPath,
        '--file-url',
        sourceAudioUrl,
        '--model',
        FUN_ASR_FILE_MODEL,
        '--api-root',
        DASHSCOPE_API_ROOT
    ];

    let stdout;
    try {
        ({ stdout } = await execFileAsync(pythonBin, args, {
            timeout: 2 * 60 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 40,
            env: {
                ...process.env,
                DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY
            }
        }));
    } catch (error) {
        throw buildProcessExecutionError(error, 'Fun-ASR 录音文件转录失败');
    }

    const result = JSON.parse(stdout);
    if (!result?.success) {
        throw new Error(result?.error || 'Fun-ASR 录音文件转录失败');
    }

    const structuredTranscript = buildStructuredTranscriptFromSegments(result.segments, {
        timingMode: result.timing_mode || 'provided',
        speakerMode: result.speaker_mode || 'diarized'
    });
    const transcript = renderStructuredTranscript(structuredTranscript) || String(result.text || '').trim();
    if (!transcript) {
        throw new Error('Fun-ASR 录音文件识别返回了空转录结果');
    }

    return {
        text: transcript,
        language: language && language !== 'auto' ? language : null,
        audioDuration: Number.isFinite(result.duration) ? result.duration : null,
        backendUsed: 'fun_asr_file_diarization',
        structuredTranscript
    };
}

async function transcribeAudioWithBackend(audioPath, backend, language = null, transcriptionOptions = {}) {
    switch (backend) {
        case 'qwen3_asr':
            return transcribeAudioWithQwen3Asr(audioPath, language, transcriptionOptions);
        case 'gemini_audio': {
            const transcript = await transcribeAudioWithGemini(audioPath, language, false, null, null, null, transcriptionOptions);
            return {
                text: transcript,
                language: detectTranscriptLanguage(transcript, language),
                audioDuration: await probeAudioDuration(audioPath),
                backendUsed: 'gemini_audio'
            };
        }
        case 'fun_asr_realtime':
            return transcribeAudioWithFunAsrRealtime(audioPath, language, transcriptionOptions);
        case 'fun_asr_file_diarization':
            return transcribeAudioWithFunAsrFileDiarization(audioPath, language, transcriptionOptions);
        case 'whisperx_local':
            return transcribeAudioWithWhisperXLocal(audioPath, language, transcriptionOptions);
        case 'whisper_local':
            return transcribeAudioWithWhisperLocal(audioPath, language, transcriptionOptions);
        default:
            throw new Error(`不支持的 ASR backend: ${backend}`);
    }
}

async function transcribeAudioWithConfiguredBackend(audioPath, requestedBackend = 'auto', language = null, transcriptionOptions = {}) {
    const normalizedBackend = normalizeAsrBackend(requestedBackend);
    if (!normalizedBackend) {
        throw new Error(`无效的 ASR backend: ${requestedBackend}`);
    }

    if (normalizedBackend !== 'auto') {
        const availability = await getBackendAvailability(normalizedBackend, transcriptionOptions);
        if (!availability.available) {
            throw new Error(`${normalizedBackend} 不可用: ${availability.reason}`);
        }

        return transcribeAudioWithBackend(audioPath, normalizedBackend, language, transcriptionOptions);
    }

    const errors = [];
    for (const backend of ASR_AUTO_BACKEND_ORDER) {
        const availability = await getBackendAvailability(backend, transcriptionOptions);
        if (!availability.available) {
            errors.push(`${backend}: ${availability.reason}`);
            continue;
        }

        try {
            return await transcribeAudioWithBackend(audioPath, backend, language, transcriptionOptions);
        } catch (error) {
            errors.push(`${backend}: ${error.message}`);
        }
    }

    throw new Error(`auto 模式下没有可用 ASR backend。${errors.join(' | ')}`);
}

async function finalizeTranscriptPipeline(rawTranscript, options = {}) {
    const {
        shouldSummarize = false,
        outputLanguage = 'zh',
        detectedLanguage,
        audioLanguage = 'auto',
        audioDuration = null,
        outputContext = null,
        originalUrl = null,
        podcastTitle = null,
        structuredTranscript = null,
        sessionId = null,
        sendProgressCallback = null
    } = options;

    const result = {
        summary: null,
        translation: null,
        needsTranslation: false
    };

    const nativeStructuredTranscript = hasNativeStructuredTranscript(structuredTranscript) ? structuredTranscript : null;
    let resolvedStructuredTranscript = nativeStructuredTranscript;
    const summarySourceTranscript = String(rawTranscript || '').trim();
    let transcript = resolvedStructuredTranscript
        ? renderStructuredTranscript(resolvedStructuredTranscript)
        : summarySourceTranscript;
    const originalTranscript = summarySourceTranscript;
    const savedFiles = [];

    if (!nativeStructuredTranscript) {
        if (sessionId && sendProgressCallback) {
            sendProgressCallback(sessionId, 50, 'optimizing', outputLanguage === 'zh' ? '优化转录文本' : 'Optimizing transcript');
        }

        let optimizedTranscript = transcript;
        let optimizationSuccess = false;
        for (let retryCount = 0; retryCount < 3; retryCount += 1) {
            try {
                console.log(`📝 开始智能优化转录文本${retryCount > 0 ? ` (重试 ${retryCount}/3)` : ''}...`);
                optimizedTranscript = await formatTranscriptText(transcript, detectTranscriptLanguage(transcript, audioLanguage));
                optimizationSuccess = true;
                break;
            } catch (optimizationError) {
                console.error(`❌ 文本优化失败 (尝试 ${retryCount + 1}/3): ${optimizationError.message}`);
                if (retryCount < 2) {
                    await new Promise((resolve) => setTimeout(resolve, (retryCount + 1) * 3000));
                }
            }
        }

        if (optimizationSuccess) {
            transcript = optimizedTranscript;
        } else {
            console.warn('🔄 AI优化失败，保留原始转录文本');
        }

        if (sessionId && sendProgressCallback) {
            sendProgressCallback(sessionId, 62, 'speaker_refining', outputLanguage === 'zh' ? '细化说话人轮次' : 'Refining speaker turns');
        }

        transcript = await refineTranscriptSpeakerTurns(
            transcript,
            detectTranscriptLanguage(transcript, audioLanguage)
        );

        const speakerNormalizedTranscript = normalizeTranscriptSpeakerLabels(transcript);
        if (speakerNormalizedTranscript) {
            transcript = speakerNormalizedTranscript;
        }
    } else {
        console.log('🎙️ 检测到真实 diarization 结果，跳过文本级说话人推断');
        if (sessionId && sendProgressCallback) {
            sendProgressCallback(sessionId, 56, 'speaker_naming', outputLanguage === 'zh' ? '识别说话人姓名' : 'Attributing speaker names');
        }

        resolvedStructuredTranscript = await attributeSpeakerNamesForStructuredTranscript(resolvedStructuredTranscript, {
            transcriptLanguage: detectTranscriptLanguage(summarySourceTranscript || transcript, audioLanguage),
            rawTranscript: summarySourceTranscript || transcript,
            podcastTitle,
            originalUrl
        });
        transcript = renderStructuredTranscript(resolvedStructuredTranscript);
    }

    if (outputContext) {
        savedFiles.push(
            writeManagedTextFile(
                formatTranscriptAsMarkdown(transcript, podcastTitle, originalUrl),
                'transcript',
                outputContext,
                '.md'
            )
        );

        if (transcript !== originalTranscript && originalTranscript) {
            savedFiles.push(
                writeManagedTextFile(
                    formatTranscriptAsMarkdown(originalTranscript, podcastTitle, originalUrl),
                    'original_transcript',
                    outputContext,
                    '.md'
                )
            );
        }
    }

    const analysisTranscript = transcript;

    if (shouldSummarize) {
        if (sessionId && sendProgressCallback) {
            sendProgressCallback(sessionId, 70, 'summary', outputLanguage === 'zh' ? '总结' : 'Summary');
        }

        result.summary = await generateSummary(analysisTranscript, outputLanguage);
        if (outputContext) {
            savedFiles.push(
                writeManagedTextFile(
                    formatSummaryAsMarkdown(result.summary, podcastTitle, outputLanguage, originalUrl),
                    'summary',
                    outputContext,
                    '.md'
                )
            );
        }
    }

    const normalizedDetectedLanguage = detectedLanguage || detectTranscriptLanguage(transcript, audioLanguage);
    if (normalizedDetectedLanguage && needsTranslation(normalizedDetectedLanguage, outputLanguage)) {
        try {
            result.translation = await translateTranscript(transcript, normalizedDetectedLanguage, outputLanguage);
            result.needsTranslation = true;

            if (outputContext) {
                savedFiles.push(
                    writeManagedTextFile(
                        formatTranslationAsMarkdown(result.translation, podcastTitle, outputLanguage, originalUrl),
                        'translation',
                        outputContext,
                        '.md'
                    )
                );
            }
        } catch (error) {
            console.error('❌ 翻译过程失败:', error.message);
        }
    }

    return {
        transcript,
        summary: result.summary,
        translation: result.translation,
        needsTranslation: result.needsTranslation,
        detectedLanguage: normalizedDetectedLanguage,
        audioDuration,
        savedFiles,
        structuredTranscript: resolvedStructuredTranscript || buildStructuredTranscript(transcript, audioDuration)
    };
}

/**
 * 处理音频文件（单个或多个片段）
 * @param {Array|string} audioFiles - 音频文件路径数组或单个路径
 * @param {boolean} shouldSummarize - 是否需要总结
 * @param {string} outputLanguage - 输出语言
 * @returns {Promise<Object>} - 处理结果
 */
async function processAudioWithOpenAI(audioFiles, shouldSummarize = false, outputLanguage = 'zh', tempDir = null, audioLanguage = 'auto', originalUrl = null, sessionId = null, sendProgressCallback = null, podcastTitle = null, transcriptionOptions = {}) {
    try {
        const requestedBackend = normalizeAsrBackend(transcriptionOptions.asrBackend || 'auto');
        if (!requestedBackend) {
            throw new Error(`无效的 ASR backend: ${transcriptionOptions.asrBackend}`);
        }

        console.log(`🤖 开始音频处理 - ASR backend=${requestedBackend}`);
        const files = Array.isArray(audioFiles) ? audioFiles : [audioFiles];
        console.log(`📄 处理文件数量: ${files.length}`);
        const outputContext = tempDir
            ? createOutputContext(podcastTitle || 'Untitled', {
                createdAt: new Date(),
                runKey: Math.random().toString(36).slice(2, 8)
            })
            : null;
        const asrResult = files.length === 1
            ? await transcribeAudioWithConfiguredBackend(files[0], requestedBackend, audioLanguage, transcriptionOptions)
            : await transcribeMultipleAudios(files, requestedBackend, outputLanguage, audioLanguage, transcriptionOptions);

        console.log(`✅ ASR 完成: backend=${asrResult.backendUsed}, chars=${asrResult.text.length}`);
        console.log(`🌐 检测到语言: ${asrResult.language || 'unknown'}`);

        const finalized = await finalizeTranscriptPipeline(asrResult.text, {
            shouldSummarize,
            outputLanguage,
            detectedLanguage: asrResult.language || null,
            audioLanguage,
            audioDuration: asrResult.audioDuration || null,
            outputContext,
            originalUrl,
            podcastTitle,
            structuredTranscript: asrResult.structuredTranscript || null,
            sessionId,
            sendProgressCallback
        });

        return {
            transcript: finalized.transcript,
            summary: finalized.summary,
            translation: finalized.translation,
            language: outputLanguage,
            detectedLanguage: finalized.detectedLanguage,
            needsTranslation: finalized.needsTranslation,
            audioDuration: finalized.audioDuration,
            savedFiles: finalized.savedFiles,
            structuredTranscript: finalized.structuredTranscript,
            asrBackendRequested: requestedBackend,
            asrBackendUsed: asrResult.backendUsed
        };

    } catch (error) {
        console.error('❌ 音频处理失败:', error);
        throw error;
    }
}

/**
 * 并发转录多个音频文件并优化拼接
 * @param {Array} audioFiles - 音频文件路径数组
 * @param {string} outputLanguage - 总结输出语言（不影响转录语言）
 * @returns {Promise<string>} - 优化后的完整转录文本
 */
async function transcribeMultipleAudios(audioFiles, requestedBackend = 'auto', outputLanguage = 'zh', audioLanguage = 'auto', transcriptionOptions = {}) {
    try {
        console.log(`🔄 开始串行转录 ${audioFiles.length} 个音频片段...`);
        const transcriptions = [];

        for (let index = 0; index < audioFiles.length; index += 1) {
            const file = audioFiles[index];
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                try {
                    console.log(`   🎵 开始转录片段 ${index + 1}/${audioFiles.length}: ${path.basename(file)} ${retryCount > 0 ? `(重试 ${retryCount})` : ''}`);
                    const result = await transcribeAudioWithConfiguredBackend(file, requestedBackend, audioLanguage, transcriptionOptions);
                    transcriptions.push({
                        index,
                        text: result.text,
                        language: result.language,
                        audioDuration: result.audioDuration,
                        backendUsed: result.backendUsed,
                        success: true
                    });
                    break;
                } catch (error) {
                    retryCount += 1;
                    if (retryCount <= maxRetries) {
                        console.warn(`   ⚠️ 片段 ${index + 1} 转录失败，准备重试 ${retryCount}/${maxRetries}: ${error.message}`);
                        await new Promise((resolve) => setTimeout(resolve, 3000 * retryCount));
                    } else {
                        console.error(`   ❌ 片段 ${index + 1} 转录最终失败:`, error);
                        transcriptions.push({
                            index,
                            text: null,
                            success: false,
                            error: error.message
                        });
                    }
                }
            }

            if (index < audioFiles.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        }

        transcriptions.sort((a, b) => a.index - b.index);
        const successfulTranscriptions = transcriptions.filter((item) => item.success && item.text);
        const failedCount = transcriptions.length - successfulTranscriptions.length;
        console.log(`📋 转录完成统计: ${successfulTranscriptions.length}/${transcriptions.length} 成功, ${failedCount} 失败`);

        if (successfulTranscriptions.length === 0) {
            throw new Error('所有音频片段转录都失败了。请检查网络连接和API配置，或稍后重试。');
        }

        if (failedCount > 0) {
            console.warn(`⚠️ ${failedCount} 个片段转录失败，将基于 ${successfulTranscriptions.length} 个成功片段继续处理`);
        }

        const rawTranscript = successfulTranscriptions
            .map((item) => item.text)
            .join('\n\n');
        console.log(`📊 有效转录内容: ${rawTranscript.length} 字符`);

        if (rawTranscript.length < 50) {
            console.warn('⚠️ 转录内容太少，跳过AI优化');
            return {
                text: rawTranscript,
                language: successfulTranscriptions[0].language || null,
                audioDuration: successfulTranscriptions.reduce((sum, item) => sum + (item.audioDuration || 0), 0) || null,
                backendUsed: successfulTranscriptions[0].backendUsed || requestedBackend
            };
        }

        const optimizedTranscript = await optimizeTranscriptContinuity(rawTranscript, outputLanguage);
        console.log(`✨ 文本优化完成: ${optimizedTranscript.length} 字符`);
        return {
            text: optimizedTranscript,
            language: successfulTranscriptions[0].language || null,
            audioDuration: successfulTranscriptions.reduce((sum, item) => sum + (item.audioDuration || 0), 0) || null,
            backendUsed: successfulTranscriptions[0].backendUsed || requestedBackend
        };

    } catch (error) {
        console.error('❌ 多文件转录失败:', error);
        throw error;
    }
}

/**
 * 使用 Gemini 直接转录音频
 * @param {string} audioPath - 音频文件路径
 * @param {string} language - 用户指定的语言代码（可选）
 * @returns {Promise<Object|string>} - 转录结果
 */
async function transcribeAudioWithGemini(
    audioPath,
    language = null,
    shouldSaveDirectly = false,
    outputContext = null,
    originalUrl = null,
    podcastTitle = null,
    transcriptionOptions = {}
) {
    let uploadedFile = null;

    try {
        console.log(`🎤 Gemini 转录: ${path.basename(audioPath)}`);

        const mimeType = getAudioMimeType(audioPath);
        uploadedFile = await getGeminiClient().files.upload({
            file: audioPath,
            config: { mimeType }
        });

        const transcriptionPrompt = buildTranscriptionPrompt(language, transcriptionOptions);
        let transcript = '';
        const startedAt = Date.now();
        let lastError = null;

        for (let index = 0; index < GEMINI_TRANSCRIBE_MODEL_CHAIN.length; index++) {
            const modelName = GEMINI_TRANSCRIBE_MODEL_CHAIN[index];

            try {
                if (index > 0) {
                    console.log(`🔄 Gemini 转录降级到模型: ${modelName}`);
                }

                const response = await getGeminiClient().models.generateContent({
                    model: modelName,
                    contents: createUserContent([
                        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || mimeType),
                        transcriptionPrompt
                    ])
                });

                transcript = (response.text || '').trim();
                if (!transcript) {
                    throw new Error('Gemini 返回了空转录结果');
                }

                break;
            } catch (error) {
                lastError = error;
                if (!isTransientGeminiError(error) || index === GEMINI_TRANSCRIBE_MODEL_CHAIN.length - 1) {
                    throw error;
                }

                const waitMs = 1500 * (index + 1);
                console.warn(`⚠️ 模型 ${modelName} 暂时不可用，${waitMs}ms 后切到下一个模型`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }

        if (!transcript) {
            throw lastError || new Error('Gemini 返回了空转录结果');
        }

        const processingTime = Math.round((Date.now() - startedAt) / 10) / 100;
        const detectedLanguage = detectTranscriptLanguage(transcript, language);
        const audioDuration = await probeAudioDuration(audioPath);
        const savedFiles = [];

        if (shouldSaveDirectly && outputContext) {
            const transcriptFile = writeManagedTextFile(
                formatTranscriptAsMarkdown(transcript, podcastTitle, originalUrl),
                'transcript',
                outputContext,
                '.md'
            );

            if (transcriptFile) {
                savedFiles.push(transcriptFile);
            }
        }

        console.log(`✅ Gemini 转录完成: ${transcript.length} 字符`);
        console.log(`📊 处理时间: ${processingTime}秒, 检测语言: ${detectedLanguage}`);

        if (shouldSaveDirectly) {
            return {
                text: transcript,
                savedFiles,
                language: detectedLanguage,
                processing_time: processingTime,
                audioDuration
            };
        }

        return transcript;
    } catch (error) {
        console.error('❌ Gemini 转录失败:', error);
        throw new Error(`Gemini 转录失败: ${error.message}`);
    } finally {
        if (uploadedFile?.name) {
            try {
                await getGeminiClient().files.delete({ name: uploadedFile.name });
            } catch (cleanupError) {
                console.warn(`⚠️ 清理 Gemini 上传文件失败: ${cleanupError.message}`);
            }
        }
    }
}

/**
 * 转录单个音频文件（Gemini 直连）
 * @param {string} audioPath - 音频文件路径
 * @param {string} autoDetect - 是否自动检测语言（转录始终保持原语言）
 * @returns {Promise<string>} - 转录文本
 */
async function transcribeAudio(audioPath, autoDetect = true) {
    return await transcribeAudioWithGemini(audioPath, autoDetect ? null : 'zh');
}



/**
 * 优化转录文本：修正错误、改善通顺度和智能分段
 * @param {string} rawTranscript - 原始转录文本
 * @param {string} transcriptLanguage - 转录文本的实际语言（用于选择优化提示词语言，不改变内容语言）
 * @returns {Promise<string>} - 优化后的转录文本（保持原始语言）
 */
async function formatTranscriptText(rawTranscript, transcriptLanguage = 'zh') {
    try {
        console.log(`📝 开始智能优化转录文本: ${rawTranscript.length} 字符 (修正错误 + 格式化)`);

        if (shouldSkipLlmTranscriptOptimization(rawTranscript)) {
            console.log('📄 跳过 LLM 优化：转录文本较短，使用基本格式化');
            return applyBasicFormatting(rawTranscript);
        }

        // 检查文本长度，超过限制时分块处理
        const maxCharsPerChunk = 4000; // 约2000-4000 tokens，适合GPT-3.5/GPT-4
        
        if (rawTranscript.length > maxCharsPerChunk) {
            console.log(`📄 文本过长 (${rawTranscript.length} 字符)，使用分块处理`);
            return await formatLongTranscriptInChunks(rawTranscript, transcriptLanguage, maxCharsPerChunk);
        }

        const prompt = transcriptLanguage === 'zh' ? 
            `请对以下音频转录文本进行智能优化和格式化，要求：

**内容优化（正确性优先）：**
1. **错误修正**：转录错误、错别字、同音字混淆、品牌名称/专有名词音译错误
2. **表达优化**：适度改善语法，补全不完整句子，保持原意和语言不变
3. **口语处理**：保留自然语气词（嗯、啊、那个），删除过度重复，添加合适标点

**分段规则（按优先级）：**
1. **强制分段边界**：
   - 商业内容转换：广告→正题，不同品牌切换
   - 节目环节转换：开场→正题→结尾
   - 发言人变化：主持人↔嘉宾，问答边界
2. **话题转换分段**：
   - 内容类型：技术细节→商业成就→数据统计→行业挑战→未来展望
   - 论述角度：产品介绍→公司发展→环保影响→解决方案
   - 时间线：过去经历→现在成就→未来计划
3. **长度控制**：单段不超过200字，超长必须按完整思路分段

**格式要求**：Markdown格式，段落间用双换行分隔，保持对话自然流畅性

**说话人要求：**
- 如果能从内容中明确判断轮次，请保留或补上通用说话人标签，如“主持人：”“嘉宾：”或“说话人 1：”“说话人 2：”
- 不要虚构人名；只有原文里明确出现的人名才可以保留
- 不要把两个说话人的内容合并进同一段

**重要提醒**：不要添加额外的分隔线（如---）或多余的空行，段落间只需标准的双换行分隔

**核心原则**：优化可读性的同时保持原意，长篇论述按话题转换合理分段

原始转录文本：
${rawTranscript}` :
            `Please intelligently optimize and format the following audio transcript text:

**Content Optimization (Accuracy First):**
1. **Error Correction**: Transcription errors, typos, homophone confusions, brand names/proper noun errors
2. **Expression Enhancement**: Moderate grammar improvement, complete incomplete sentences, preserve original meaning and language
3. **Speech Processing**: Keep natural filler words (um, ah, like, you know), remove excessive repetitions, add appropriate punctuation

**Segmentation Rules (By Priority):**
1. **Mandatory Segmentation Boundaries**:
   - Commercial content transitions: ads→main content, brand switching
   - Program segment transitions: opening→main content→ending
   - Speaker changes: host↔guest, question-answer boundaries
2. **Topic Transition Segmentation**:
   - Content types: technical details→business achievements→data statistics→industry challenges→future outlook
   - Perspective shifts: product introduction→company development→environmental impact→solutions
   - Timeline: past experiences→current achievements→future plans
3. **Length Control**: Single paragraphs should not exceed 300 words, long content must be segmented by complete thoughts

**Format Requirements**: Markdown format, double line breaks between paragraphs, maintain natural conversational flow

**Speaker Requirements:**
- If speaker turns are clear from the content, preserve or add generic speaker labels like "Host:", "Guest:", "Speaker 1:", or "Speaker 2:"
- Do not invent speaker names; only keep names that are explicit in the transcript
- Do not merge two speakers into the same paragraph

**Important Reminder**: Do not add extra separators (like ---) or excessive blank lines, use only standard double line breaks between paragraphs

**Core Principle**: Optimize readability while preserving original meaning, segment long monologues by topic transitions

Original transcript text:
${rawTranscript}`;

        const response = await getOpenAIClient().chat.completions.create({
            model: AI_FAST_MODEL,
            messages: [
                {
                    role: 'system',
                    content: '你是一个专业的音频转录文本优化助手，负责修正转录错误、改善文本通顺度和排版格式，但必须保持原意不变，不删减或添加内容。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 4096,
            temperature: 0.1
        });

        const optimizedText = response.choices[0].message.content.trim();

        if (isSuspiciousOptimizationResult(rawTranscript, optimizedText)) {
            console.warn('⚠️ 文本优化结果疑似偏航，回退到基本格式化');
            return applyBasicFormatting(rawTranscript);
        }
        
        // 调试: 检查优化后的分段情况
        console.log('🔍 OpenAI优化后文本前500字符:', JSON.stringify(optimizedText.substring(0, 500)));
        console.log('🔍 OpenAI优化后换行符数量:', (optimizedText.match(/\n/g) || []).length);
        
        const formattedText = ensureMarkdownParagraphs(optimizedText);
        
        console.log('🔍 ensureMarkdownParagraphs后文本前500字符:', JSON.stringify(formattedText.substring(0, 500)));
        console.log(`✅ 文本优化完成: ${rawTranscript.length} → ${formattedText.length} 字符`);
        
        return formattedText;
        
    } catch (error) {
        console.error('❌ 文本优化失败:', error.message);
        console.warn('🔄 应用基本格式化');
        return applyBasicFormatting(rawTranscript); // 失败时使用基本格式化
    }
}

/**
 * 优化转录文本的连续性和流畅性
 * @param {string} rawTranscript - 原始拼接的转录文本
 * @param {string} outputLanguage - 输出语言（仅影响优化提示语言，不改变内容语言）
 * @returns {Promise<string>} - 优化后的转录文本
 */
async function optimizeTranscriptContinuity(rawTranscript, outputLanguage) {
    try {
        console.log(`🔧 开始优化文本连续性...`);
        
        // 检查文本质量，避免处理错误信息
        if (rawTranscript.includes('[转录失败') || rawTranscript.includes('error') || rawTranscript.length < 20) {
            console.log('📄 跳过优化：文本质量不足或包含错误信息');
            return rawTranscript;
        }
        
        const systemPrompt = outputLanguage === 'zh' 
            ? `你是一个专业的文本编辑助手。请优化以下转录文本，使其更流畅自然：

任务要求：
1. 保持原文的完整意思和语言，不要改变或删减内容
2. 优化片段间的衔接，使语句更连贯
3. 清理多余的语气词（嗯、啊、那个等），但保留必要的语气表达
4. 修正明显的断句错误
5. 保持说话者的原始语言风格和表达习惯
6. 不要翻译或改变原文语言
7. 不要添加原文中没有的信息

请直接输出优化后的文本，保持原语言，不要添加任何解释或标注。`

            : `You are a professional text editing assistant. Please optimize the following transcript to make it more fluent and natural:

Requirements:
1. Maintain the complete meaning and language of the original text, do not change or remove content
2. Optimize transitions between segments for better coherence
3. Clean up excessive filler words (um, uh, like, etc.) while keeping necessary expressions
4. Fix obvious sentence breaks
5. Maintain the speaker's original language style and expression habits
6. Do not translate or change the original language
7. Do not add information not present in the original text

Please output the optimized text directly in the original language without any explanations or annotations.`;

        const response = await getOpenAIClient().chat.completions.create({
            model: AI_SUMMARY_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: rawTranscript }
            ],
            temperature: 0.3,
            max_tokens: Math.min(4000, Math.floor(rawTranscript.length * 1.2))
        });

        const optimizedText = response.choices[0].message.content.trim();
        console.log(`✨ 文本优化完成`);
        
        return optimizedText;

    } catch (error) {
        console.error('❌ 文本优化失败:', error);
        console.log('📄 应用基本格式化');
        return applyBasicFormatting(rawTranscript); // 失败时使用基本格式化
    }
}

/**
 * 生成播客内容总结
 * @param {string} transcript - 播客转录文本
 * @param {string} outputLanguage - 输出语言
 * @returns {Promise<string>} - 播客内容总结
 */
async function generateSummary(transcript, outputLanguage = 'zh') {
    try {
        console.log(`📋 生成总结 (${outputLanguage})...`);
        
        // 智能处理不同长度的文本
        // 考虑token限制：GPT-4约8000 tokens，中文1-2字符=1token，安全起见用6000字符
        const maxCharsForDirectSummary = 6000; // 约3000-6000 tokens，适合GPT-4
        
        if (transcript.length <= maxCharsForDirectSummary) {
            // 对于适中长度的文本，直接生成总结
            return await generateDirectSummary(transcript, outputLanguage);
        } else {
            // 对于超长文本，使用智能分块策略
            console.log(`📄 文本过长 (${transcript.length} 字符)，使用智能分块总结策略`);
            return await generateSmartChunkedSummary(transcript, outputLanguage);
        }
    } catch (error) {
        console.error('❌ 总结生成失败:', error);
        throw new Error(`总结生成失败: ${error.message}`);
    }
}

/**
 * 根据语言获取系统提示词
 */
function getSystemPromptByLanguage(outputLanguage) {
    const prompts = {
        zh: `你是一个专业的播客内容分析师。请为以下播客节目生成一个全面、结构化的总结：

总结要求：
1. 提取播客的主要话题和核心观点
2. 保持逻辑结构清晰，突出播客的核心价值
3. 包含重要的讨论内容、观点和结论
4. 使用简洁明了的语言
5. 适当保留嘉宾/主持人的表达风格和重要观点

**重要：严格排除以下无价值内容（这是核心要求）：**
- 播客制作信息（制作团队、编辑、混音师、制作公司等）
- **赞助商广告和商业推广内容**（任何公司、产品、服务的宣传，包括但不限于保险公司、移动服务商、投资平台、SaaS服务等）
- **节目资助方信息**（如"本节目由...赞助"、"感谢...的支持"等）
- 播客标准开头结尾语（如"欢迎收听"、"感谢收听"等）
- 技术制作细节和播客平台信息
- 主持人介绍播客本身的元信息
- **任何形式的商业广告内容**，即使被包装成节目内容的一部分

**重要提醒：如果某段内容主要是在推广产品或服务，即使与主题相关，也应完全排除。只保留纯粹的知识性、信息性、观点性内容。**

段落组织要求（核心）：
1. **按语意和逻辑主题分段** - 每当话题转换、讨论重点改变、或从一个观点转向另一个观点时，必须开始新段落
2. **每个段落专注一个主要观点或主题**
3. **段落之间必须有空行分隔（双换行符\n\n）** 
4. **思考内容的逻辑流程，合理划分段落边界**

格式要求：
1. 使用Markdown格式，段落之间使用双换行
2. 每个段落应是完整的逻辑单元

请仔细分析内容的语意结构，按逻辑主题合理分段。**必须使用中文输出。**`,

        en: `You are a professional podcast content analyst. Please generate a comprehensive, structured summary for the following podcast episode:

Summary requirements:
1. Extract main topics and core viewpoints from the podcast
2. Maintain clear logical structure highlighting the podcast's core value
3. Include important discussions, viewpoints, and conclusions
4. Use concise and clear language
5. Appropriately retain the hosts'/guests' expression style and important viewpoints

**Important: Strictly exclude the following non-valuable content (this is a core requirement):**
- Podcast production information (production team, editors, sound engineers, production companies, etc.)
- **Sponsor advertisements and commercial promotional content** (any company, product, or service promotion, including but not limited to insurance companies, mobile service providers, investment platforms, SaaS services, etc.)
- **Program sponsorship information** (such as "this show is sponsored by...", "thanks to... for their support", etc.)
- Standard podcast opening/closing statements (like "welcome to", "thanks for listening", etc.)
- Technical production details and podcast platform information
- Host introductions about the podcast itself (meta-information)
- **Any form of commercial advertising content**, even if packaged as part of the program content

**Important reminder: If a segment is primarily promoting a product or service, even if related to the topic, it should be completely excluded. Only retain purely knowledge-based, informational, and opinion-based content.**

Paragraph Organization Requirements (Core):
1. **Organize by semantic and logical themes** - Start a new paragraph whenever the topic shifts, discussion focus changes, or when moving from one viewpoint to another
2. **Each paragraph should focus on one main viewpoint or theme**
3. **Paragraphs must be separated by double line breaks (\n\n)**
4. **Think about the logical flow of content and reasonably divide paragraph boundaries**

Format requirements:
1. Use Markdown format with double line breaks between paragraphs
2. Each paragraph should be a complete logical unit

Please carefully analyze the semantic structure of the content and organize paragraphs logically by themes. **Must output in English.**`,

        es: `Eres un analista profesional de contenido de podcasts. Por favor, genera un resumen integral y estructurado para el siguiente episodio de podcast:

Requisitos del resumen:
1. Extraer los temas principales y puntos de vista centrales del podcast
2. Mantener una estructura lógica clara destacando el valor central del podcast
3. Incluir discusiones importantes, puntos de vista y conclusiones
4. Usar un lenguaje conciso y claro
5. Retener apropiadamente el estilo de expresión y puntos de vista importantes de los anfitriones/invitados

Requisitos de formato (Importante):
1. Usar formato Markdown, con doble salto de línea entre párrafos
2. Cada párrafo debe ser una unidad lógica completa

Por favor, genera un resumen estructurado del contenido del podcast con puntos clave y contenido esencial. La salida debe seguir los requisitos de formato markdown. **Debe generar la salida en español.**`,

        fr: `Vous êtes un analyste professionnel de contenu de podcasts. Veuillez générer un résumé complet et structuré pour l'épisode de podcast suivant :

Exigences du résumé :
1. Extraire les sujets principaux et les points de vue centraux du podcast
2. Maintenir une structure logique claire mettant en évidence la valeur centrale du podcast
3. Inclure les discussions importantes, les points de vue et les conclusions
4. Utiliser un langage concis et clair
5. Conserver de manière appropriée le style d'expression et les points de vue importants des hôtes/invités

Exigences de format (Important) :
1. Utiliser le format Markdown, avec un double saut de ligne entre les paragraphes
2. Chaque paragraphe doit être une unité logique complète

Veuillez générer un résumé structuré du contenu du podcast avec les points clés et le contenu essentiel. La sortie doit suivre les exigences de format markdown. **Doit générer la sortie en français.**`,

        de: `Sie sind ein professioneller Podcast-Content-Analyst. Bitte erstellen Sie eine umfassende, strukturierte Zusammenfassung für die folgende Podcast-Episode:

Zusammenfassungsanforderungen:
1. Hauptthemen und zentrale Standpunkte des Podcasts extrahieren
2. Klare logische Struktur beibehalten, die den zentralen Wert des Podcasts hervorhebt
3. Wichtige Diskussionen, Standpunkte und Schlussfolgerungen einbeziehen
4. Präzise und klare Sprache verwenden
5. Ausdrucksstil und wichtige Standpunkte der Moderatoren/Gäste angemessen bewahren

Formatanforderungen (Wichtig):
1. Markdown-Format verwenden, mit doppeltem Zeilenumbruch zwischen Absätzen
2. Jeder Absatz sollte eine vollständige logische Einheit sein

Bitte erstellen Sie eine strukturierte Zusammenfassung des Podcast-Inhalts mit Schlüsselpunkten und wesentlichen Inhalten. Die Ausgabe muss den Markdown-Formatanforderungen entsprechen. **Muss die Ausgabe auf Deutsch generieren.**`
    };

    return prompts[outputLanguage] || prompts.en;
}

/**
 * 直接生成总结（适用于中等长度文本）
 */
async function generateDirectSummary(transcript, outputLanguage) {
    const systemPrompt = getSystemPromptByLanguage(outputLanguage);

        const response = await getOpenAIClient().chat.completions.create({
            model: AI_DEFAULT_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: transcript }
            ],
            temperature: 0.5,
        max_tokens: Math.min(3000, Math.floor(transcript.length * 0.4))
        });

        const summary = response.choices[0].message.content.trim();
    const formattedSummary = ensureMarkdownParagraphs(summary);
    console.log(`📄 总结生成完成: ${formattedSummary.length} 字符`);
    
    return formattedSummary;
}

/**
 * 智能分块总结（适用于超长文本）
 */
async function generateSmartChunkedSummary(transcript, outputLanguage) {
    try {
        const maxCharsPerChunk = 4000; // 每块最大字符数，约2000-4000 tokens
        
        // 智能分块：按段落和句子边界分割
        const chunks = smartChunkText(transcript, maxCharsPerChunk);
        console.log(`📊 文本分为 ${chunks.length} 块进行总结`);
        
        // 为每个分块生成简要总结
        const chunkSummaries = [];
        for (let i = 0; i < chunks.length; i++) {
            console.log(`🔄 总结第 ${i + 1}/${chunks.length} 块 (${chunks[i].length} 字符)`);
            
            try {
                // 直接调用OpenAI生成分块总结，避免递归
                const chunkSummary = await generateChunkSummary(chunks[i], outputLanguage);
                chunkSummaries.push(chunkSummary);
                
                // 添加延迟避免API限制
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (chunkError) {
                console.warn(`⚠️ 第 ${i + 1} 块总结失败: ${chunkError.message}`);
                chunkSummaries.push(`[第${i + 1}块总结失败]`);
            }
        }
        
        // 合并所有分块总结（使用空行分隔，不用分割线）
        const combinedSummary = chunkSummaries.join('\n\n');
        
        // 最终整合成完整总结
        const finalSummary = await generateFinalSummary(combinedSummary, outputLanguage);
        console.log(`✅ 智能分块总结完成: ${transcript.length} → ${finalSummary.length} 字符`);
        
        return finalSummary;

    } catch (error) {
        console.error('❌ 智能分块总结失败:', error.message);
        throw error;
    }
}

/**
 * 智能文本分块函数
 */
function smartChunkText(text, maxCharsPerChunk) {
    const chunks = [];
    
    // 首先按段落分割
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
        let currentChunk = '';
        
    for (const paragraph of paragraphs) {
        const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;
        
            if (testChunk.length > maxCharsPerChunk && currentChunk) {
            // 当前块已满，保存并开始新块
                chunks.push(currentChunk.trim());
            currentChunk = paragraph;
            } else {
                currentChunk = testChunk;
            }
        }
        
    // 添加最后一块
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        
    // 如果某些块仍然太大，进一步按句子分割
        const finalChunks = [];
        for (const chunk of chunks) {
            if (chunk.length <= maxCharsPerChunk) {
                finalChunks.push(chunk);
            } else {
            // 按句子分割
            const sentences = chunk.split(/[。！？.!?]+/).filter(s => s.trim());
            let sentenceChunk = '';
            
            for (const sentence of sentences) {
                const testSentenceChunk = sentenceChunk + (sentenceChunk ? '。' : '') + sentence;
                if (testSentenceChunk.length > maxCharsPerChunk && sentenceChunk) {
                    finalChunks.push(sentenceChunk.trim());
                    sentenceChunk = sentence;
                } else {
                    sentenceChunk = testSentenceChunk;
                }
            }
            
            if (sentenceChunk.trim()) {
                finalChunks.push(sentenceChunk.trim());
            }
        }
    }
    
    return finalChunks;
}

/**
 * 获取分块总结的系统提示词
 */
function getChunkSummaryPrompt(outputLanguage) {
    const prompts = {
        zh: `请为这段播客内容生成简要总结，要求：
1. 提取主要观点和关键信息
2. 保持简洁但不遗漏重要内容
3. 使用中文输出
4. 保持逻辑清晰
5. **严格排除广告、赞助商内容、制作信息、播客元信息等无价值内容**

这是播客的一部分内容，请生成这部分的要点总结：`,
        en: `Please generate a brief summary for this podcast segment, requirements:
1. Extract main viewpoints and key information
2. Keep concise but don't miss important content
3. Output in English
4. Maintain clear logic
5. **Strictly exclude advertisements, sponsor content, production information, podcast meta-information and other non-valuable content**

This is part of a podcast, please generate key points summary for this segment:`,
        es: `Por favor, genera un resumen breve para este segmento del podcast, requisitos:
1. Extraer los puntos de vista principales e información clave
2. Mantener conciso pero no perder contenido importante
3. Generar salida en español
4. Mantener lógica clara

Esta es parte de un podcast, por favor genera un resumen de puntos clave para este segmento:`,
        fr: `Veuillez générer un résumé bref pour ce segment de podcast, exigences :
1. Extraire les points de vue principaux et informations clés
2. Rester concis mais ne pas manquer de contenu important
3. Générer la sortie en français
4. Maintenir une logique claire

Ceci est une partie d'un podcast, veuillez générer un résumé des points clés pour ce segment :`,
        de: `Bitte erstellen Sie eine kurze Zusammenfassung für dieses Podcast-Segment, Anforderungen:
1. Hauptstandpunkte und Schlüsselinformationen extrahieren
2. Prägnant bleiben, aber keine wichtigen Inhalte verpassen
3. Ausgabe auf Deutsch generieren
4. Klare Logik beibehalten

Dies ist ein Teil eines Podcasts, bitte erstellen Sie eine Zusammenfassung der Schlüsselpunkte für dieses Segment:`
    };
    
    return prompts[outputLanguage] || prompts.en;
}

/**
 * 生成单个分块的总结
 */
async function generateChunkSummary(chunkText, outputLanguage) {
    const systemPrompt = getChunkSummaryPrompt(outputLanguage);

    const response = await getOpenAIClient().chat.completions.create({
        model: AI_SUMMARY_MODEL,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: chunkText }
        ],
        temperature: 0.3,
        max_tokens: 1200
    });

    const chunkSummary = response.choices[0].message.content.trim();
    return ensureMarkdownParagraphs(chunkSummary);
}

/**
 * 获取最终整合总结的系统提示词
 */
function getFinalSummaryPrompt(outputLanguage) {
    const prompts = {
        zh: `请将以下分段总结整合成一个完整、连贯的播客总结：

要求：
1. 去除重复内容，保持逻辑清晰
2. 按主题或时间顺序重新组织内容
3. 每个段落之间必须有一个空行分隔（两个换行符）
4. 确保输出的是Markdown格式，段落间有空行
5. 使用简洁明了的中文
6. **必须使用中文输出**
7. 形成一个完整的播客内容总结
8. **必须严格排除广告、赞助商内容、制作信息、播客元信息等所有无价值内容**

请整理为结构化的播客总结：`,
        en: `Please integrate the following segmented summaries into a complete, coherent podcast summary:

Requirements:
1. Remove duplicate content and maintain clear logic
2. Reorganize content by themes or chronological order
3. Each paragraph must be separated by double line breaks
4. Ensure output is in Markdown format with double line breaks between paragraphs
5. Use concise and clear English
6. **Must output in English**
7. Form a complete podcast content summary
8. **Must strictly exclude advertisements, sponsor content, production information, podcast meta-information and all other non-valuable content**

Please organize into a structured podcast summary:`,
        es: `Por favor, integra los siguientes resúmenes segmentados en un resumen completo y coherente del podcast:

Requisitos:
1. Eliminar contenido duplicado y mantener lógica clara
2. Reorganizar contenido por temas u orden cronológico
3. Cada párrafo debe estar separado por una línea en blanco (doble salto de línea)
4. Asegurar que la salida esté en formato Markdown con líneas en blanco entre párrafos
5. Usar español conciso y claro
6. **Debe generar la salida en español**
7. Formar un resumen completo del contenido del podcast

Por favor, organiza en un resumen estructurado del podcast:`,
        fr: `Veuillez intégrer les résumés segmentés suivants en un résumé complet et cohérent du podcast :

Exigences :
1. Supprimer le contenu dupliqué et maintenir une logique claire
2. Réorganiser le contenu par thèmes ou ordre chronologique
3. Chaque paragraphe doit être séparé par une ligne vide (double saut de ligne)
4. S'assurer que la sortie soit en format Markdown avec des lignes vides entre les paragraphes
5. Utiliser un français concis et clair
6. **Doit générer la sortie en français**
7. Former un résumé complet du contenu du podcast

Veuillez organiser en un résumé structuré du podcast :`,
        de: `Bitte integrieren Sie die folgenden segmentierten Zusammenfassungen in eine vollständige, kohärente Podcast-Zusammenfassung:

Anforderungen:
1. Doppelte Inhalte entfernen und klare Logik beibehalten
2. Inhalte nach Themen oder chronologischer Reihenfolge neu organisieren
3. Jeder Absatz muss durch eine Leerzeile getrennt sein (doppelter Zeilenumbruch)
4. Sicherstellen, dass die Ausgabe im Klartext-Absatzformat mit Leerzeilen zwischen Absätzen ist, ohne Überschriften, Listen oder andere Markdown-Elemente
5. Prägnantes und klares Deutsch verwenden
6. **Muss die Ausgabe auf Deutsch generieren**
7. Eine vollständige Podcast-Inhaltszusammenfassung bilden

Bitte organisieren Sie als strukturierte Podcast-Zusammenfassung:`
    };
    
    return prompts[outputLanguage] || prompts.en;
}

/**
 * 生成最终整合总结
 */
async function generateFinalSummary(combinedSummary, outputLanguage) {
    const systemPrompt = getFinalSummaryPrompt(outputLanguage);

    const response = await getOpenAIClient().chat.completions.create({
                model: AI_SUMMARY_MODEL,
                messages: [
            { role: "system", content: systemPrompt },
                    { role: "user", content: combinedSummary }
                ],
                temperature: 0.3,
        max_tokens: 4000
    });

    const finalSummary = response.choices[0].message.content.trim();
    return ensureMarkdownParagraphs(finalSummary);
}

/**
 * 格式化单个文本块（不进行分块检查，避免递归）
 */
async function formatSingleChunk(chunkText, transcriptLanguage = 'zh') {
    try {
        const prompt = transcriptLanguage === 'zh' ? 
            `请对以下音频转录文本进行智能优化和格式化，要求：

**内容优化（正确性优先）：**
1. **错误修正**：转录错误、错别字、同音字混淆、品牌名称/专有名词音译错误
2. **表达优化**：适度改善语法，补全不完整句子，保持原意和语言不变
3. **口语处理**：保留自然语气词（嗯、啊、那个），删除过度重复，添加合适标点

**分段规则（按优先级）：**
1. **强制分段边界**：
   - 商业内容转换：广告→正题，不同品牌切换
   - 节目环节转换：开场→正题→结尾
   - 发言人变化：主持人↔嘉宾，问答边界
2. **话题转换分段**：
   - 内容类型：技术细节→商业成就→数据统计→行业挑战→未来展望
   - 论述角度：产品介绍→公司发展→环保影响→解决方案
   - 时间线：过去经历→现在成就→未来计划
3. **长度控制**：单段不超过200字，超长必须按完整思路分段

**格式要求**：Markdown格式，段落间用双换行分隔，保持对话自然流畅性

**重要提醒**：不要添加额外的分隔线（如---）或多余的空行，段落间只需标准的双换行分隔

**核心原则**：优化可读性的同时保持原意，长篇论述按话题转换合理分段

**上下文处理**：如有[上文续：...]标记，利用上下文理解完整含义，但不要在输出中包含标记，不要重复上下文内容，只输出新内容部分

原始转录文本：
${chunkText}` :
            `Please intelligently optimize and format the following audio transcript text:

**Content Optimization (Accuracy First):**
1. **Error Correction**: Transcription errors, typos, homophone confusions, brand names/proper noun errors
2. **Expression Enhancement**: Moderate grammar improvement, complete incomplete sentences, preserve original meaning and language
3. **Speech Processing**: Keep natural filler words (um, ah, like, you know), remove excessive repetitions, add appropriate punctuation

**Segmentation Rules (By Priority):**
1. **Mandatory Segmentation Boundaries**:
   - Commercial content transitions: ads→main content, brand switching
   - Program segment transitions: opening→main content→ending
   - Speaker changes: host↔guest, question-answer boundaries
2. **Topic Transition Segmentation**:
   - Content types: technical details→business achievements→data statistics→industry challenges→future outlook
   - Perspective shifts: product introduction→company development→environmental impact→solutions
   - Timeline: past experiences→current achievements→future plans
3. **Length Control**: Single paragraphs should not exceed 300 words, long content must be segmented by complete thoughts

**Format Requirements**: Markdown format, double line breaks between paragraphs, maintain natural conversational flow

**Important Reminder**: Do not add extra separators (like ---) or excessive blank lines, use only standard double line breaks between paragraphs

**Core Principle**: Optimize readability while preserving original meaning, segment long monologues by topic transitions

**Context Handling**: If [Context continued: ...] markers exist, use context to understand complete meaning but do not include markers in output, do not repeat context content, only output new content parts

Original transcript text:
${chunkText}`;

        const response = await getOpenAIClient().chat.completions.create({
            model: AI_FAST_MODEL,
            messages: [
                {
                    role: 'system',
                    content: '你是一个专业的音频转录文本优化助手，负责修正转录错误、改善文本通顺度和排版格式，但必须保持原意不变，不删减或添加内容。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 4096,
            temperature: 0.1
        });

        const optimizedText = response.choices[0].message.content.trim();
        return ensureMarkdownParagraphs(optimizedText);
        
    } catch (error) {
        console.error('❌ 单块文本优化失败:', error.message);
        return applyBasicFormatting(chunkText); // 失败时使用基本格式化
    }
}

/**
 * 检测转录文本的实际语言，用于选择合适的优化提示词
 * @param {string} transcript - 转录文本
 * @param {string} audioLanguage - 用户指定的音频语言
 * @returns {string} - 检测到的语言代码
 */
function detectTranscriptLanguage(transcript, audioLanguage) {
    // 如果用户明确指定了音频语言，直接使用
    if (audioLanguage && audioLanguage !== 'auto') {
        return audioLanguage;
    }
    
    // 简单的语言检测逻辑
    const text = transcript.substring(0, 1000); // 取前1000个字符进行检测
    
    // 检测中文字符比例
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    const chineseRatio = chineseChars.length / text.length;
    
    // 检测拉丁字符比例（包括英文、西班牙文、法文、德文等）
    const latinChars = text.match(/[a-zA-ZÀ-ÿ]/g) || [];
    const latinRatio = latinChars.length / text.length;
    
    // 检测日文字符
    const japaneseChars = text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || [];
    const japaneseRatio = japaneseChars.length / text.length;
    
    // 检测韩文字符
    const koreanChars = text.match(/[\uac00-\ud7af]/g) || [];
    const koreanRatio = koreanChars.length / text.length;
    
    // 检测俄文字符
    const cyrillicChars = text.match(/[\u0400-\u04ff]/g) || [];
    const cyrillicRatio = cyrillicChars.length / text.length;
    
    // 根据字符比例判断语言
    if (chineseRatio > 0.3) {
        console.log(`🔍 检测到中文内容，使用中文优化提示词 (中文字符比例: ${(chineseRatio * 100).toFixed(1)}%)`);
        return 'zh';
    } else if (japaneseRatio > 0.1) {
        console.log(`🔍 检测到日文内容，使用英文优化提示词 (日文字符比例: ${(japaneseRatio * 100).toFixed(1)}%)`);
        return 'en';
    } else if (koreanRatio > 0.1) {
        console.log(`🔍 检测到韩文内容，使用英文优化提示词 (韩文字符比例: ${(koreanRatio * 100).toFixed(1)}%)`);
        return 'en';
    } else if (cyrillicRatio > 0.3) {
        console.log(`🔍 检测到俄文内容，使用英文优化提示词 (俄文字符比例: ${(cyrillicRatio * 100).toFixed(1)}%)`);
        return 'en';
    } else if (latinRatio > 0.5) {
        console.log(`🔍 检测到拉丁字符内容（英文/西班牙文/法文等），使用英文优化提示词 (拉丁字符比例: ${(latinRatio * 100).toFixed(1)}%)`);
        return 'en';
    } else {
        // 默认使用英文提示词，但不改变转录内容语言
        console.log(`🔍 语言检测不确定，默认使用英文优化提示词`);
        return 'en';
    }
}

/**
 * 确保文本段落格式正确，添加必要的空行
 * @param {string} text - 需要格式化的文本
 * @returns {string} - 格式化后的文本
 */
function ensureMarkdownParagraphs(text) {
    if (!text) return text;
    
    let formatted = text;
    
    // 第一步：标准化换行符
    formatted = formatted.replace(/\r\n/g, '\n'); // 统一换行符
    
    // 第二步：确保Markdown元素后有正确的段落分隔
    // 标题后面确保有双换行
    formatted = formatted.replace(/(^#{1,6}\s+.*)\n([^\n#])/gm, '$1\n\n$2');
    
    // 列表项后确保有段落分隔
    formatted = formatted.replace(/(\n[-*+]\s+.*)\n([^\n\-*+\s])/g, '$1\n\n$2');
    
    // 引用块后确保有段落分隔
    formatted = formatted.replace(/(\n>.*)\n([^\n>])/g, '$1\n\n$2');
    
    // 第三步：清理格式
    // 移除行首尾多余空格
    const lines = formatted.split('\n');
    const cleanedLines = lines.map(line => line.trim());
    formatted = cleanedLines.join('\n');
    
    // 标准化段落间距：最多保留双换行
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // 移除开头和结尾的空行
    formatted = formatted.replace(/^\n+/, '').replace(/\n+$/, '');
    
    return formatted;
}

/**
 * 智能分割超长文本块，避免在句子中间分割
 */
function smartSplitLongChunk(text, maxCharsPerChunk) {
    const chunks = [];
    let currentPos = 0;
    
    while (currentPos < text.length) {
        let endPos = Math.min(currentPos + maxCharsPerChunk, text.length);
        
        // 如果不是最后一块，寻找安全的分割点
        if (endPos < text.length) {
            // 优先在句子边界分割
            const sentenceEnd = text.lastIndexOf('.', endPos);
            const questionEnd = text.lastIndexOf('?', endPos);
            const exclamationEnd = text.lastIndexOf('!', endPos);
            const chinesePeriod = text.lastIndexOf('。', endPos);
            const chineseQuestion = text.lastIndexOf('？', endPos);
            const chineseExclamation = text.lastIndexOf('！', endPos);
            
            const sentenceBoundary = Math.max(sentenceEnd, questionEnd, exclamationEnd, 
                                            chinesePeriod, chineseQuestion, chineseExclamation);
            
            if (sentenceBoundary > currentPos + maxCharsPerChunk * 0.7) {
                endPos = sentenceBoundary + 1;
            } else {
                // 在单词边界分割（空格）
                const spaceBoundary = text.lastIndexOf(' ', endPos);
                if (spaceBoundary > currentPos + maxCharsPerChunk * 0.8) {
                    endPos = spaceBoundary;
                }
                // 如果找不到好的分割点，保持原来的endPos（但这种情况很少）
            }
        }
        
        chunks.push(text.substring(currentPos, endPos).trim());
        currentPos = endPos;
    }
    
    return chunks.filter(chunk => chunk.length > 0);
}

/**
 * 检测两段文本之间的重复内容
 */
function findOverlapBetweenTexts(text1, text2) {
    let overlap = '';
    const maxLength = Math.min(text1.length, text2.length);
    
    // 从最长可能的重复开始检查，逐渐减少长度
    for (let length = maxLength; length >= 20; length--) {
        const suffix = text1.slice(-length);
        const prefix = text2.slice(0, length);
        
        if (suffix === prefix) {
            // 找到重复内容后，寻找安全的切割点
            const safeCutPoint = findSafeCutPoint(prefix);
            if (safeCutPoint > 20) { // 确保仍有足够长度的重复内容
                overlap = prefix.slice(0, safeCutPoint);
            } else {
                overlap = suffix; // 如果找不到安全切割点，使用原逻辑
            }
            break;
        }
    }
    
    return overlap;
}

/**
 * 找到安全的文本切割点，避免在句子中间切断
 */
function findSafeCutPoint(text) {
    // 优先级：段落边界 > 句子边界 > 短语边界
    
    // 1. 寻找段落分隔符之前的位置
    const paragraphMatch = text.lastIndexOf('\n\n');
    if (paragraphMatch > 0) {
        return paragraphMatch + 2; // 包含段落分隔符
    }
    
    // 2. 寻找句子边界（中文和英文标点）
    const sentenceEndings = /[。！？\.!?]\s*/g;
    let lastSentenceEnd = -1;
    let match;
    while ((match = sentenceEndings.exec(text)) !== null) {
        lastSentenceEnd = match.index + match[0].length;
    }
    if (lastSentenceEnd > 20) {
        return lastSentenceEnd;
    }
    
    // 3. 寻找短语边界（逗号、分号等）
    const phraseEndings = /[，；,;]\s*/g;
    let lastPhraseEnd = -1;
    while ((match = phraseEndings.exec(text)) !== null) {
        lastPhraseEnd = match.index + match[0].length;
    }
    if (lastPhraseEnd > 20) {
        return lastPhraseEnd;
    }
    
    // 4. 如果都找不到，返回原长度（使用原逻辑）
    return text.length;
}

/**
 * 应用基本格式化（当AI优化失败时的回退方案）
 * @param {string} text - 需要格式化的文本
 * @returns {string} - 基本格式化后的文本
 */
function applyBasicFormatting(text) {
    if (!text || text.trim().length === 0) {
        return text;
    }
    
    console.log(`📝 应用基本格式化: ${text.length} 字符`);
    
    // 按句子分割（支持中英文标点）
    const sentences = text.split(/([。！？\.!?]+\s*)/).filter(s => s.trim());
    const paragraphs = [];
    let currentParagraph = '';
    const maxParagraphLength = 200; // 单段最大字符数
    
    for (let i = 0; i < sentences.length; i += 2) {
        const sentence = sentences[i] + (sentences[i + 1] || '');
        const testParagraph = currentParagraph + sentence;
        
        if (testParagraph.length > maxParagraphLength && currentParagraph) {
            // 当前段落已够长，开始新段落
            paragraphs.push(currentParagraph.trim());
            currentParagraph = sentence;
        } else {
            currentParagraph = testParagraph;
        }
    }
    
    // 添加最后一段
    if (currentParagraph.trim()) {
        paragraphs.push(currentParagraph.trim());
    }
    
    // 用双换行连接段落
    const formatted = paragraphs.join('\n\n');
    
    // 应用Markdown段落格式化
    const result = ensureMarkdownParagraphs(formatted);
    
    console.log(`✅ 基本格式化完成: ${text.length} → ${result.length} 字符，${paragraphs.length} 段`);
    
    return result;
}

/**
 * 分块处理超长转录文本
 */
async function formatLongTranscriptInChunks(rawTranscript, transcriptLanguage, maxCharsPerChunk) {
    try {
        // 智能分块：确保不在句子中间分割，保持上下文完整性
        let chunks = [];
        
        // 使用更智能的分句方式，支持中英文标点
        const sentences = rawTranscript.split(/([。！？\.!?]+\s*)/).filter(s => s.trim());
        let currentChunk = '';
        
        for (let i = 0; i < sentences.length; i += 2) {
            const sentence = sentences[i] + (sentences[i + 1] || '');
            const testChunk = currentChunk + sentence;
            
            if (testChunk.length > maxCharsPerChunk && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk = testChunk;
            }
        }
        
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        
        // 对于仍然超长的块，使用更安全的分割方式
        const finalChunks = [];
        for (const chunk of chunks) {
            if (chunk.length <= maxCharsPerChunk) {
                finalChunks.push(chunk);
            } else {
                // 寻找安全的分割点（空格、标点符号）
                const safeChunks = smartSplitLongChunk(chunk, maxCharsPerChunk);
                finalChunks.push(...safeChunks);
            }
        }
        
        chunks = finalChunks;
        
        console.log(`📊 文本分为 ${chunks.length} 块处理`);
        
        const optimizedChunks = [];
        for (let i = 0; i < chunks.length; i++) {
            console.log(`🔄 处理第 ${i + 1}/${chunks.length} 块 (${chunks[i].length} 字符)`);
            
            try {
                // 为非首块添加前文上下文，避免断句错误
                let chunkWithContext = chunks[i];
                let contextMarker = '';
                if (i > 0) {
                    // 取前一块的最后100字符作为上下文
                    const prevContext = chunks[i - 1].slice(-100);
                    
                    // 根据语言使用对应的上下文标记
                    if (transcriptLanguage === 'zh') {
                        contextMarker = `[上文续：${prevContext}]`;
                    } else {
                        contextMarker = `[Context continued: ${prevContext}]`;
                    }
                    
                    chunkWithContext = `${contextMarker}\n\n${chunks[i]}`;
                    console.log(`📎 第 ${i + 1} 块添加了上下文 (${prevContext.length} 字符)`);
                }
                
                // 调用优化函数
                let optimizedChunk = await formatSingleChunk(chunkWithContext, transcriptLanguage);
                
                // 如果添加了上下文，移除上下文标记部分
                if (i > 0) {
                    // 移除中文或英文的上下文标记
                    optimizedChunk = optimizedChunk.replace(/^\[(上文续|Context continued)：?:?.*?\]\s*/s, '');
                }
                
                optimizedChunks.push(optimizedChunk);
                
                // 添加延迟避免API限制
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (chunkError) {
                console.warn(`⚠️ 第 ${i + 1} 块优化失败，使用原始文本: ${chunkError.message}`);
                // 应用基本格式化，而不是直接使用原始文本
                const basicFormatted = applyBasicFormatting(chunks[i]);
                optimizedChunks.push(basicFormatted);
            }
        }
        
        // 智能去重：检测相邻块之间的重复内容
        const deduplicatedChunks = [];
        for (let i = 0; i < optimizedChunks.length; i++) {
            let currentChunk = optimizedChunks[i];
            
            if (i > 0 && deduplicatedChunks.length > 0) {
                // 检查当前块开头是否与前一块结尾重复
                const prevChunk = deduplicatedChunks[deduplicatedChunks.length - 1];
                const prevEnd = prevChunk.slice(-200); // 取前一块的最后200字符
                const currentStart = currentChunk.slice(0, 200); // 取当前块的前200字符
                
                // 寻找重复的句子或片段
                const overlapMatch = findOverlapBetweenTexts(prevEnd, currentStart);
                if (overlapMatch.length > 20) { // 如果重复内容超过20字符
                    console.log(`🔍 检测到重复内容，自动去重: ${overlapMatch.length} 字符`);
                    currentChunk = currentChunk.substring(overlapMatch.length).trim(); // 去除开头空格
                    
                    // 如果去重后文本为空或太短，跳过此块
                    if (currentChunk.length < 10) {
                        continue;
                    }
                }
            }
            
            if (currentChunk.trim()) {
                deduplicatedChunks.push(currentChunk);
            }
        }
        
        const combinedText = deduplicatedChunks.join('\n\n');
        const result = ensureMarkdownParagraphs(combinedText);
        console.log(`✅ 分块优化完成: ${rawTranscript.length} → ${result.length} 字符`);
        
        return result;
        
    } catch (error) {
        console.error('❌ 分块优化失败:', error.message);
        return applyBasicFormatting(rawTranscript);
    }
}

function buildSpeakerRefinementChunks(transcript, maxCharsPerChunk = 2800) {
    const cleanedTranscript = stripTranscriptPresentationArtifacts(transcript);
    if (!cleanedTranscript) {
        return [];
    }

    const blocks = splitTranscriptIntoTurnBlocks(cleanedTranscript);
    if (blocks.length === 0) {
        return [cleanedTranscript];
    }

    const chunks = [];
    let currentChunk = '';

    for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) {
            continue;
        }

        const candidateChunk = currentChunk ? `${currentChunk}\n\n${trimmedBlock}` : trimmedBlock;
        if (candidateChunk.length > maxCharsPerChunk && currentChunk) {
            chunks.push(currentChunk);
            currentChunk = trimmedBlock;
        } else {
            currentChunk = candidateChunk;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

function extractSpeakerRefinementContext(transcript, maxTurns = 4) {
    const blocks = splitTranscriptIntoTurnBlocks(stripTranscriptPresentationArtifacts(transcript));
    return blocks.slice(-maxTurns).join('\n');
}

async function refineSpeakerTurnsSingleChunk(chunkText, transcriptLanguage = 'zh', previousContext = '') {
    const labelGuide = transcriptLanguage === 'zh'
        ? '主持人：、嘉宾：、说话人 1：、说话人 2：'
        : 'Host:, Guest:, Speaker 1:, Speaker 2:';
    const continuityPrompt = previousContext
        ? transcriptLanguage === 'zh'
            ? `前文最近几轮如下，仅用于保持标签一致性，不要复述这些内容：\n${previousContext}\n\n`
            : `Recent labeled turns for continuity only. Do not repeat them in the output:\n${previousContext}\n\n`
        : '';
    const prompt = transcriptLanguage === 'zh'
        ? `${continuityPrompt}请只做“说话人轮次细分”这一个任务，处理下面这段播客转录。

严格要求：
1. 保持原文语言和原有措辞，不能改写、润色、纠错、补句、总结或删减。
2. 你只允许做两件事：
   - 在说话人切换处重新分段
   - 在段首补上或修正通用说话人标签
3. 标签只能用：${labelGuide}
4. 如果无法判断，就不要强行标注，直接保留无标签段落。
5. 不要虚构人名，不要添加时间戳，不要输出解释。

请直接输出处理后的正文：
${chunkText}`
        : `${continuityPrompt}Your only task is to re-segment the following podcast transcript by speaker turns.

Strict requirements:
1. Preserve the original wording and language exactly. Do not rewrite, polish, correct, summarize, or remove content.
2. You may only do two things:
   - split paragraphs at speaker boundaries
   - add or correct generic speaker labels at the start of a paragraph
3. Use labels only from: ${labelGuide}
4. If you are not confident, leave the paragraph unlabeled instead of guessing.
5. Do not invent names, do not add timestamps, do not add explanations.

Return only the processed transcript:
${chunkText}`;

    const response = await getOpenAIClient().chat.completions.create({
        model: AI_SPEAKER_MODEL,
        messages: [
            {
                role: 'system',
                content: transcriptLanguage === 'zh'
                    ? '你是一个严格的播客转录说话人细分助手，只能调整说话人边界和通用标签，不能改写正文。'
                    : 'You are a strict podcast speaker-turn segmentation assistant. You may only adjust speaker boundaries and generic labels, never rewrite the transcript.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        temperature: 0.1,
        max_tokens: Math.min(4096, Math.max(800, Math.floor(chunkText.length * 1.35)))
    });

    return ensureMarkdownParagraphs(response.choices[0].message.content.trim());
}

async function refineTranscriptSpeakerTurns(transcript, transcriptLanguage = 'zh') {
    try {
        const cleanedTranscript = stripTranscriptPresentationArtifacts(transcript);
        if (!cleanedTranscript || cleanedTranscript.length < 120) {
            return transcript;
        }

        const chunks = buildSpeakerRefinementChunks(cleanedTranscript);
        if (chunks.length === 0) {
            return transcript;
        }

        console.log(`🎙️ 开始细化说话人轮次: ${chunks.length} 块`);
        const refinedChunks = [];
        let previousContext = '';

        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            try {
                const refinedChunk = await refineSpeakerTurnsSingleChunk(chunk, transcriptLanguage, previousContext);
                const acceptedChunk = isSpeakerRefinementSafe(chunk, refinedChunk) ? refinedChunk : chunk;

                if (acceptedChunk === chunk) {
                    console.warn(`⚠️ 第 ${index + 1} 块说话人细分结果偏离原文，已回退原文本块`);
                }

                refinedChunks.push(acceptedChunk);
                previousContext = extractSpeakerRefinementContext(acceptedChunk);
            } catch (error) {
                console.error(`❌ 第 ${index + 1} 块说话人细分失败: ${error.message}`);
                refinedChunks.push(chunk);
                previousContext = extractSpeakerRefinementContext(chunk);
            }

            if (index < chunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
        }

        const combinedTranscript = ensureMarkdownParagraphs(refinedChunks.join('\n\n'));
        console.log(`✅ 说话人轮次细化完成`);
        return combinedTranscript || transcript;
    } catch (error) {
        console.error('❌ 说话人轮次细化失败:', error.message);
        return transcript;
    }
}

/**
 * 翻译转录内容
 * @param {string} transcript - 原始转录内容
 * @param {string} sourceLanguage - 源语言
 * @param {string} targetLanguage - 目标语言
 * @returns {Promise<string>} - 翻译后的内容
 */
async function translateTranscript(transcript, sourceLanguage, targetLanguage) {
    try {
        console.log(`🌍 翻译转录内容 (${sourceLanguage} → ${targetLanguage})...`);
        
        // 语言映射
        const languageNames = {
            zh: '中文',
            en: '英文',
            es: '西班牙语',
            fr: '法语',
            de: '德语'
        };
        
        const sourceName = languageNames[sourceLanguage] || sourceLanguage;
        const targetName = languageNames[targetLanguage] || targetLanguage;
        
        // 智能处理不同长度的文本
        const maxCharsForDirectTranslation = 6000;
        
        if (transcript.length <= maxCharsForDirectTranslation) {
            // 对于适中长度的文本，直接翻译
            return await translateDirect(transcript, sourceName, targetName);
        } else {
            // 对于长文本，使用分块翻译策略
            return await translateInChunks(transcript, sourceName, targetName);
        }
        
    } catch (error) {
        console.error('❌ 翻译失败:', error.message);
        throw error;
    }
}

/**
 * 直接翻译（适用于中等长度文本）
 */
async function translateDirect(transcript, sourceName, targetName) {
    const prompt = `你是一个专业的播客内容翻译专家。请将以下${sourceName}播客转录内容翻译成${targetName}：

翻译要求：
1. 保持原文的语言风格和表达习惯
2. 准确传达原意和语境
3. 保持段落结构和格式
4. 对于专业术语和人名地名，使用通用翻译标准
5. 保持语言的自然流畅

请直接输出翻译结果，不要添加额外说明。

原文内容：
${transcript}`;

    const response = await getOpenAIClient().chat.completions.create({
        model: AI_DEFAULT_MODEL,
        messages: [
            {
                role: "user",
                content: prompt
            }
        ],
        temperature: 0.1,
        max_tokens: 4000
    });

    return response.choices[0].message.content.trim();
}

/**
 * 分块翻译（适用于长文本）
 */
async function translateInChunks(transcript, sourceName, targetName) {
    console.log(`📄 文本过长 (${transcript.length} 字符)，使用智能分块翻译策略`);
    
    // 将文本按段落和句子智能分块
    const chunkSize = 3500; // 较保守的分块大小
    const chunks = smartSplitLongChunk(transcript, chunkSize);
    
    console.log(`📊 文本分为 ${chunks.length} 块进行翻译`);
    
    const translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`🔄 翻译第 ${i + 1}/${chunks.length} 块 (${chunk.length} 字符)`);
        
        try {
            const translatedChunk = await translateDirect(chunk, sourceName, targetName);
            translatedChunks.push(translatedChunk);
            
            // 添加延迟避免API限制
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            console.error(`❌ 翻译第 ${i + 1} 块失败:`, error.message);
            // 如果翻译失败，保留原文
            translatedChunks.push(chunk);
        }
    }
    
    const finalTranslation = translatedChunks.join('\n\n');
    console.log(`✅ 智能分块翻译完成: ${transcript.length} → ${finalTranslation.length} 字符`);
    
    return finalTranslation;
}

/**
 * 检测语言是否需要翻译
 * @param {string} detectedLanguage - Whisper检测的语言
 * @param {string} targetLanguage - 用户选择的输出语言
 * @returns {boolean} - 是否需要翻译
 */
function needsTranslation(detectedLanguage, targetLanguage) {
    // 语言代码标准化
    const normalizeLanguage = (lang) => {
        if (!lang) return 'unknown';
        const langMap = {
            'en': 'en',
            'english': 'en',
            'zh': 'zh',
            'chinese': 'zh',
            'zh-cn': 'zh',
            'zh-hans': 'zh',
            'es': 'es',
            'spanish': 'es',
            'fr': 'fr',
            'french': 'fr',
            'de': 'de',
            'german': 'de'
        };
        return langMap[lang.toLowerCase()] || lang.toLowerCase();
    };
    
    const normalizedDetected = normalizeLanguage(detectedLanguage);
    const normalizedTarget = normalizeLanguage(targetLanguage);
    
    return normalizedDetected !== normalizedTarget && normalizedDetected !== 'unknown';
}

module.exports = {
    SUPPORTED_ASR_BACKENDS,
    normalizeAsrBackend,
    processAudioWithOpenAI,
    transcribeAudio,
    transcribeAudioWithGemini,
    transcribeAudioWithWhisperLocal,
    transcribeAudioWithWhisperXLocal,
    transcribeAudioWithQwen3Asr,
    transcribeAudioWithFunAsrRealtime,
    transcribeAudioWithFunAsrFileDiarization,
    transcribeAudioWithConfiguredBackend,
    transcribeMultipleAudios,
    buildStructuredTranscript,
    buildStructuredTranscriptFromSegments,
    renderStructuredTranscript,
    hasNativeStructuredTranscript,
    attributeSpeakerNamesForStructuredTranscript,
    formatTranscriptAsMarkdown,
    normalizeTranscriptSpeakerLabels,
    formatTranscriptText,
    refineTranscriptSpeakerTurns,
    formatSummaryAsMarkdown,
    formatTranslationAsMarkdown,
    optimizeTranscriptContinuity,
    generateSummary,
    translateTranscript,
    needsTranslation,
    detectTranscriptLanguage
};
