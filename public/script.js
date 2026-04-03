// 双语内容配置
const translations = {
    zh: {
        title: "Podcast Summer",
        subtitle: "输入链接或音频文件，直接查看转录结果。",
        sourceLabel: "内容来源",
        sourceUrlTitle: "播客链接",
        sourceUrlDesc: "适合 Apple Podcasts、小宇宙、RSS 和直接音频链接",
        sourceFileTitle: "本地音频",
        sourceFileDesc: "把录音或导出的播客文件直接拖进来处理",
        urlLabel: "Podcast音频链接",
        urlHelper: "支持 Apple Podcasts、小宇宙、RSS订阅源和直接音频链接",
        pickAudioText: "选择音频文件",
        fileHelper: "支持 mp3、m4a、wav、aac、ogg、flac、mp4、webm",
        selectedFileLabel: "已选文件",
        clearFileText: "清除",
        operationLabel: "操作类型",
        option1Title: "转录并总结",
        option1Desc: "获得转录文本和AI总结",
        option2Title: "仅转录",
        option2Desc: "只获得转录文本",
        audioLangLabel: "音频语言",
        outputLangLabel: "总结语言",
        autoDetect: "自动检测",
        chineseOption: "中文",
        englishOption: "English",
        submitText: "🚀 开始处理",
        resultsTitle: "处理结果",
        transcriptTitle: "转录文本",
        summaryTitle: "AI总结",
        translationTitle: "翻译",
        loadingText: "正在处理您的播客...",
        errorText: "处理过程中出现错误",
        emptyStateTitle: "结果会直接出现在这里",
        emptyStateBody: "处理完成后直接显示转录稿。",
        emptyStateBullet1: "默认先看转录稿。",
        emptyStateBullet2: "总结和翻译按需切换。",
        emptyStateBullet3: "需要时再打开保存位置。",
        copyActiveText: "复制当前内容",
        revealFileText: "打开保存位置",
        desktopModeApp: "桌面 App",
        desktopModeWeb: "浏览器模式",
        desktopStatusApp: "结果固定显示在工作区",
        desktopStatusWeb: "浏览器也支持本地音频",
        localFileReady: "已准备好本地音频文件",
        remoteSourceLabel: "来源：播客链接",
        localSourceLabel: "来源：本地音频",
        languageLabel: "识别语言",
        durationLabel: "音频时长",
        fileCountLabel: "输出文件",
        copySuccess: "已复制当前内容",
        estimatedTime: "预计需要 3-8 分钟...",
        processingTips: "处理中：",
        tipKeepOpen: "保持窗口开启",
        tipLargeFile: "大文件更慢",
        tipAutoShow: "完成后自动显示结果",
        stepUpload: "导入音频...",
        stepDownload: "下载音频文件",
        stepTranscribe: "AI语音转录中...",
        stepSummarize: "生成智能总结",
        processingComplete: "处理完成！",
        remainingTime: "预计还需",
        minutes: "分钟",
        almostDone: "即将完成...",
        langFlag: "🇨🇳",
        langText: "中文"
    },
    en: {
        title: "Podcast Summer",
        subtitle: "Paste a link or drop an audio file, then read the transcript here.",
        sourceLabel: "Source",
        sourceUrlTitle: "Podcast link",
        sourceUrlDesc: "Best for Apple Podcasts, RSS, Xiaoyuzhou, and direct audio URLs",
        sourceFileTitle: "Local audio",
        sourceFileDesc: "Drop a recording or exported episode file directly into the app",
        urlLabel: "Podcast Audio Link",
        urlHelper: "Supports Apple Podcasts, RSS feeds, Xiaoyuzhou, and direct audio links",
        pickAudioText: "Choose audio file",
        fileHelper: "Supports mp3, m4a, wav, aac, ogg, flac, mp4, and webm",
        selectedFileLabel: "Selected file",
        clearFileText: "Clear",
        operationLabel: "Operation Type",
        option1Title: "Transcribe & Summarize",
        option1Desc: "Get transcription and AI summary",
        option2Title: "Transcribe Only",
        option2Desc: "Get transcription text only",
        audioLangLabel: "Audio Language",
        outputLangLabel: "Summary Language",
        autoDetect: "Auto Detect",
        chineseOption: "Chinese",
        englishOption: "English",
        submitText: "🚀 Start Processing",
        resultsTitle: "Results",
        transcriptTitle: "Transcript",
        summaryTitle: "AI Summary",
        translationTitle: "Translation",
        loadingText: "Processing your podcast...",
        errorText: "An error occurred during processing",
        emptyStateTitle: "Results land here immediately",
        emptyStateBody: "The transcript appears here as soon as processing finishes.",
        emptyStateBullet1: "Transcript first.",
        emptyStateBullet2: "Summary and translation only when needed.",
        emptyStateBullet3: "Reveal the saved file if you need it.",
        copyActiveText: "Copy current view",
        revealFileText: "Reveal saved file",
        desktopModeApp: "Desktop App",
        desktopModeWeb: "Browser Mode",
        desktopStatusApp: "Results stay in the workspace",
        desktopStatusWeb: "Browser mode also supports local audio",
        localFileReady: "Local audio file is ready",
        remoteSourceLabel: "Source: Podcast link",
        localSourceLabel: "Source: Local audio",
        languageLabel: "Detected language",
        durationLabel: "Audio duration",
        fileCountLabel: "Files",
        copySuccess: "Copied the current view",
        estimatedTime: "Estimated 3-8 minutes...",
        processingTips: "Processing:",
        tipKeepOpen: "Keep the window open",
        tipLargeFile: "Large files take longer",
        tipAutoShow: "Results appear automatically",
        stepUpload: "Importing audio...",
        stepDownload: "Download audio file",
        stepTranscribe: "AI transcription in progress...",
        stepSummarize: "Generate smart summary",
        processingComplete: "Processing complete!",
        remainingTime: "Estimated",
        minutes: "minutes remaining",
        almostDone: "Almost done...",
        langFlag: "🇺🇸",
        langText: "English"
    }
};

// 检测浏览器语言设置
function detectBrowserLanguage() {
    // 尝试从localStorage获取用户之前的选择
    const savedLang = localStorage.getItem('podcast-transcriber-language');
    if (savedLang && (savedLang === 'zh' || savedLang === 'en')) {
        return savedLang;
    }
    
    // 检测浏览器语言
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    
    // 如果是中文（包括简体、繁体、香港、台湾等），返回中文
    if (browserLang.toLowerCase().startsWith('zh')) {
        return 'zh';
    }
    
    // 默认返回英文
    return 'en';
}

// 当前语言状态 - 根据浏览器语言自动检测
let currentLang = detectBrowserLanguage();
let selectedSourceMode = 'url';
let selectedAudioFile = null;
let lastResultData = null;
let activeTabId = null;
let desktopState = {
    isDesktop: false,
    tempDir: null
};

function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function getDesktopBridge() {
    return window.desktopApp || null;
}

async function initializeDesktopMode() {
    const bridge = getDesktopBridge();

    if (!bridge) {
        updateDesktopChrome();
        return;
    }

    try {
        desktopState = await bridge.getState();
    } catch (error) {
        console.warn('Desktop bridge unavailable, falling back to browser mode.', error);
        desktopState = { isDesktop: true, tempDir: null };
    }

    updateDesktopChrome();
    updateActionButtons();
}

function formatDurationLabel(seconds) {
    if (!seconds || Number.isNaN(seconds)) {
        return null;
    }

    const totalSeconds = Math.round(Number(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    if (minutes === 0) {
        return `${remainingSeconds}s`;
    }

    if (remainingSeconds === 0) {
        return `${minutes}m`;
    }

    return `${minutes}m ${remainingSeconds}s`;
}

function estimateDurationFromFileSize(bytes) {
    if (!bytes) {
        return null;
    }

    return Math.max(120, Math.round(bytes / 16384));
}

// 语言切换功能
function toggleLanguage() {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    
    // 保存用户的语言选择
    localStorage.setItem('podcast-transcriber-language', currentLang);
    
    updateUI();
    updateLanguageToggle();
    
    // 更新HTML lang属性
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
}

// 更新UI文本
function updateUI() {
    const texts = translations[currentLang];
    
    // 更新所有文本元素
    Object.keys(texts).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            if (key === 'autoDetect' || key === 'chineseOption' || key === 'englishOption') {
                element.textContent = texts[key];
            } else {
                element.textContent = texts[key];
            }
        }
    });
    
    // 更新placeholder
    const urlInput = document.getElementById('podcastUrl');
    urlInput.placeholder = currentLang === 'zh' 
        ? 'https://example.com/podcast/episode'
        : 'https://example.com/podcast/example';

    const pickAudioButton = document.getElementById('pickAudioButton');
    if (pickAudioButton) {
        pickAudioButton.textContent = texts.pickAudioText;
    }
    
    // 更新进度页面的文本元素
    const progressElements = {
        'stepUploadText': 'stepUpload',
        'stepDownloadText': 'stepDownload',
        'stepTranscribeText': 'stepTranscribe', 
        'stepSummarizeText': 'stepSummarize',
        'processingTipsText': 'processingTips',
        'tipLargeFileText': 'tipLargeFile',
        'tipKeepOpenText': 'tipKeepOpen',
        'tipAutoShowText': 'tipAutoShow'
    };
    
    Object.keys(progressElements).forEach(elementId => {
        const element = document.getElementById(elementId);
        const textKey = progressElements[elementId];
        if (element && texts[textKey]) {
            element.textContent = texts[textKey];
        }
    });
    
    // 进度条现在由智能进度条系统统一管理，无需在此处更新
    
    // 如果有下载按钮显示，重新生成以更新语言
    const downloadSection = document.getElementById('downloadSection');
    if (downloadSection && !downloadSection.classList.contains('hidden')) {
        // 获取当前的savedFiles数据并重新生成下载按钮
        updateDownloadButtonsLanguage();
    }

    updateDesktopChrome();
    updateSelectedFileCard();
    updateResultMeta(lastResultData);
    updateActionButtons();

    if (lastResultData && !document.getElementById('resultsContent').classList.contains('hidden')) {
        const previousTab = activeTabId;
        showResultsContent(lastResultData);
        if (previousTab) {
            activateTab(previousTab);
        }
    }
}

function createProgressConnection(sessionId) {
    try {
        const eventSource = new EventSource(`/api/progress/${sessionId}`);
        setupProgressListener(eventSource);
        return eventSource;
    } catch (error) {
        console.warn('SSE连接失败，使用模拟进度:', error);
        return null;
    }
}

function closeProgressConnection(eventSource, reason = 'normal') {
    if (!eventSource) {
        return;
    }

    eventSource.close();
    console.log(`🔌 SSE连接已关闭（${reason}）`);
}

async function uploadLocalAudioFile(audioFile, sessionId) {
    const uploadData = new FormData();
    uploadData.append('audioFile', audioFile);
    uploadData.append('sessionId', sessionId);

    const response = await fetch('/api/upload-audio', {
        method: 'POST',
        body: uploadData
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || '上传音频失败');
    }

    return result.data;
}

async function processRemoteAudio(data) {
    const controller = new AbortController();
    let estimatedDuration = null;

    if (!smartProgressBar) initializeProgressBar();
    smartProgressBar.currentStage = 'parsing';
    smartProgressBar.updateProgress(7, 'Analyzing audio...', false);

    try {
        const estimateController = new AbortController();
        const estimateTimeoutId = setTimeout(() => estimateController.abort(), 30000);
        const estimateResponse = await fetch('/api/estimate-duration', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: data.url }),
            signal: estimateController.signal
        });

        clearTimeout(estimateTimeoutId);

        if (estimateResponse.ok) {
            const estimateResult = await estimateResponse.json();
            if (estimateResult.success) {
                estimatedDuration = estimateResult.estimatedDuration;
            }
        }
    } catch (estimateError) {
        console.warn('⚠️ 音频时长预估失败，使用默认估算:', estimateError.message);
    }

    startProgressSimulation(estimatedDuration);

    const response = await fetch('/api/process-podcast', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

async function processLocalAudio(data) {
    if (!selectedAudioFile) {
        throw new Error(currentLang === 'zh' ? '请先选择音频文件' : 'Please select an audio file first');
    }

    const estimatedDuration = estimateDurationFromFileSize(selectedAudioFile.size);
    startProgressSimulation(estimatedDuration);
    smartProgressBar.currentStage = 'uploading';
    smartProgressBar.currentProgress = 6;
    smartProgressBar.updateProgressDisplay(6);

    const uploadResult = await uploadLocalAudioFile(selectedAudioFile, data.sessionId);

    const response = await fetch('/api/process-local-file', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...data,
            filename: uploadResult.filename,
            originalName: uploadResult.originalName || selectedAudioFile.name
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

// 表单提交处理
async function processPodcast(event) {
    event.preventDefault();

    const form = event.target;
    const formData = new FormData(form);
    const sessionId = generateSessionId();
    const data = {
        operation: formData.get('operation'),
        audioLanguage: document.getElementById('audioLanguage').value,
        outputLanguage: document.getElementById('outputLanguage').value,
        sessionId
    };

    if (selectedSourceMode === 'url') {
        data.url = document.getElementById('podcastUrl').value;
    }

    console.log('Processing podcast with data:', {
        ...data,
        sourceMode: selectedSourceMode,
        fileName: selectedAudioFile?.name || null
    });

    showResults();
    showLoadingWithProgress();
    let eventSource = createProgressConnection(sessionId);

    try {
        const result = selectedSourceMode === 'file'
            ? await processLocalAudio(data)
            : await processRemoteAudio(data);

        stopProgressSimulation();

        if (result.success) {
            const processingMinutes = smartProgressBar && smartProgressBar.smartProgress.startTime
                ? (Date.now() - smartProgressBar.smartProgress.startTime) / 1000 / 60
                : 0;

            if (result.data.actualDuration) {
                const audioMinutes = result.data.actualDuration / 60;
                const actualRatio = audioMinutes > 0 ? processingMinutes / audioMinutes : 0;

                if (actualRatio > 0) {
                    localStorage.setItem('audioProcessingRatio', actualRatio.toString());
                }
            }

            showResultsContent(result.data, data.operation);
        } else {
            showError(result.error || 'Unknown error occurred');
        }

        closeProgressConnection(eventSource, 'completed');
    } catch (error) {
        console.error('Error processing podcast:', error);
        stopProgressSimulation();
        closeProgressConnection(eventSource, 'error');

        if (error.name === 'AbortError') {
            console.log('🔄 检测到超时，正在检查处理结果...');
            await checkForCompletedFiles();
        } else {
            showError(error.message);
        }
    }
}

// 检查是否有已完成的文件
async function checkForCompletedFiles() {
    try {
        // 显示检查状态
        showLoadingWithProgress();
        
        // 获取temp目录中的文件列表
        const response = await fetch('/api/temp-files');
        if (!response.ok) {
            throw new Error('无法获取文件列表');
        }
        
        const result = await response.json();
        
        // 查找最新的转录和总结文件
        const allFiles = result.files || [];
        const transcriptFiles = allFiles.filter(f => f.filename.includes('_transcript.md'));
        const summaryFiles = allFiles.filter(f => f.filename.includes('_summary.md'));
        
        if (transcriptFiles.length > 0) {
            // 找到了转录文件，构造成功响应
            const latestTranscript = transcriptFiles[transcriptFiles.length - 1];
            const latestSummary = summaryFiles.find(f => 
                f.filename.startsWith(latestTranscript.filename.split('_transcript')[0])
            );
            
            // 读取文件内容
            const transcriptContent = await fetchFileContent(latestTranscript.filename);
            
            const mockResult = {
                transcript: transcriptContent,
                summary: latestSummary ? await fetchFileContent(latestSummary.filename) : null,
                language: 'zh',
                savedFiles: [
                    {
                        type: 'transcript',
                        filename: latestTranscript.filename,
                        size: latestTranscript.size
                    }
                ]
            };
            
            if (latestSummary) {
                mockResult.savedFiles.push({
                    type: 'summary', 
                    filename: latestSummary.filename,
                    size: latestSummary.size
                });
            }
            
            stopProgressSimulation();
            
            // 显示成功结果
            const operation = latestSummary ? 'transcribe_summarize' : 'transcribe_only';
            showResultsContent(mockResult, operation);
            
            // 显示成功消息
            const successMsg = currentLang === 'zh' ? 
                '✅ 检测到处理已完成！文件已成功生成。' : 
                '✅ Processing completed! Files generated successfully.';
            console.log(successMsg);
            
        } else {
            // 没有找到文件，显示真正的超时错误
            showError('处理超时，请检查网络连接或稍后重试 / Processing timeout, please check network or retry later');
        }
        
    } catch (error) {
        console.error('检查文件时出错:', error);
        showError('处理超时，请检查网络连接或稍后重试 / Processing timeout, please check network or retry later');
    }
}

// 获取文件内容
async function fetchFileContent(filename) {
    try {
        const response = await fetch(`/api/download/${filename}`);
        if (!response.ok) {
            throw new Error(`无法读取文件: ${filename}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`读取文件 ${filename} 失败:`, error);
        return '文件内容读取失败';
    }
}

// 显示结果区域
function showResults() {
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.classList.remove('hidden');

    if (window.innerWidth < 1080) {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// 显示加载状态
function showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('resultsContent').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('resultMetaBar').classList.add('hidden');
    
    // 禁用提交按钮
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
}

// 显示带进度的加载状态
function showLoadingWithProgress() {
    showLoading();
    
    // 重置进度条（使用新的智能进度条）
    
    // 重置智能进度条
    if (!smartProgressBar) initializeProgressBar();
    smartProgressBar.reset();
}

// ========================================
// 智能进度条系统 - 完全重写版本
// ========================================

class SmartProgressBar {
    constructor() {
        // DOM元素
        this.progressSection = document.getElementById('progressSection');
        this.progressTitle = document.getElementById('progressTitle');
        this.progressStatus = document.getElementById('progressStatus');
        this.progressFill = document.getElementById('progressFill');
        this.progressMessage = document.getElementById('progressMessage');
        
        // 进度状态
        this.currentProgress = 5;
        this.serverProgress = 0;
        this.currentStage = 'preparing';
        this.isActive = false;
        
        // 智能模拟
        this.smartProgress = {
            interval: null,
            startTime: null,
            estimatedDuration: null,
            lastServerUpdate: 0
        };
        
        // 阶段配置
        this.stageConfig = {
            'preparing': { speed: 0.5, maxProgress: 5, message: 'Preparing...' },
            'uploading': { speed: 0.6, maxProgress: 14, message: 'Importing audio...' },
            'parsing': { speed: 0.8, maxProgress: 15, message: 'Parsing audio information...' },
            'downloading': { speed: 0.3, maxProgress: 35, message: 'Downloading audio...' },
            'transcribing': { speed: 0.2, maxProgress: 55, message: 'Transcribing audio...' },
            'optimizing': { speed: 0.5, maxProgress: 75, message: 'Optimizing transcript...' },
            'summarizing': { speed: 0.4, maxProgress: 95, message: 'Generating summary...' },
            'translating': { speed: 0.3, maxProgress: 98, message: 'Translating content...' },
            'complete': { speed: 0, maxProgress: 100, message: 'Processing complete!' }
        };
        
        // 多语言支持
        this.translations = {
            zh: {
                title: '处理进度',
                preparing: '准备中...',
                uploading: '导入音频...',
                parsing: '解析音频信息...',
                downloading: '下载音频...',
                transcribing: '转录音频...',
                optimizing: '优化转录文本...',
                summarizing: '生成摘要...',
                translating: '翻译内容...',
                complete: '处理完成！'
            },
            en: {
                title: 'Processing Progress',
                preparing: 'Preparing...',
                uploading: 'Importing audio...',
                parsing: 'Parsing audio information...',
                downloading: 'Downloading audio...',
                transcribing: 'Transcribing audio...',
                optimizing: 'Optimizing transcript...',
                summarizing: 'Generating summary...',
                translating: 'Translating content...',
                complete: 'Processing complete!'
            }
        };
    }
    
    // 主要进度更新入口
    updateProgress(progress, message, fromServer = false) {
        if (fromServer) {
            this.serverProgress = progress;
            this.smartProgress.lastServerUpdate = Date.now();
            
            // 识别阶段
            this.detectStage(message, progress);
            
            console.log(`📊 服务器进度更新: ${progress}% - ${message}`);
            
            // 服务器进度更新：始终跳跃到服务器进度（前进或后退）
            if (this.serverProgress !== this.currentProgress) {
                const direction = this.serverProgress > this.currentProgress ? '前进' : '后退';
                console.log(`🔄 进度${direction}: ${this.currentProgress}% → ${this.serverProgress}%`);
                this.currentProgress = this.serverProgress;
            }
        }
        
        // 更新显示
        this.updateProgressDisplay(this.currentProgress, message);
    }
    
    // 检测处理阶段
    detectStage(message, progress) {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('upload') || lowerMessage.includes('导入')) {
            this.currentStage = 'uploading';
        } else if (lowerMessage.includes('download') || lowerMessage.includes('下载')) {
            this.currentStage = 'downloading';
        } else if (lowerMessage.includes('transcrib') || lowerMessage.includes('转录')) {
            this.currentStage = 'transcribing';
        } else if (lowerMessage.includes('optim') || lowerMessage.includes('优化')) {
            this.currentStage = 'optimizing';
        } else if (lowerMessage.includes('summar') || lowerMessage.includes('总结')) {
            this.currentStage = 'summarizing';
        } else if (lowerMessage.includes('translat') || lowerMessage.includes('翻译')) {
            this.currentStage = 'translating';
        } else if (lowerMessage.includes('complete') || lowerMessage.includes('完成')) {
            this.currentStage = 'complete';
        } else if (progress >= 95) {
            this.currentStage = 'complete';
        } else if (progress >= 10) {
            // 如果进度超过10%但没有明确阶段，至少切换到parsing阶段
            if (this.currentStage === 'preparing') {
                this.currentStage = 'parsing';
            }
        }
    }
    
    // 更新进度显示
    updateProgressDisplay(progress, message = null) {
        const roundedProgress = Math.round(progress * 10) / 10;
        const lang = currentLang || 'en';
        
        // 更新百分比
        if (this.progressStatus) {
            this.progressStatus.textContent = `${roundedProgress}%`;
        }
        
        // 更新进度条
        if (this.progressFill) {
            this.progressFill.style.width = `${roundedProgress}%`;
            this.progressFill.setAttribute('aria-valuenow', roundedProgress);
        }
        
        // 更新标题
        if (this.progressTitle) {
            this.progressTitle.textContent = this.translations[lang].title;
        }
        
        // 更新消息 - 始终使用本地化文本，忽略服务器文本
        if (this.progressMessage) {
            let displayMessage;
            if (this.currentStage) {
                displayMessage = this.translations[lang][this.currentStage] || 
                                this.stageConfig[this.currentStage].message;
            } else {
                displayMessage = this.translations[lang].preparing;
            }
            this.progressMessage.textContent = displayMessage;
        }
    }
    
    // 启动智能进度模拟
    startSmartProgress(estimatedDuration = null) {
        this.isActive = true;
        this.smartProgress.startTime = Date.now();
        this.smartProgress.estimatedDuration = estimatedDuration;
        this.currentProgress = Math.max(this.currentProgress, 5);
        
        console.log('🚀 启动智能进度模拟');
        
        this.smartProgress.interval = setInterval(() => {
            this.simulateProgress();
        }, 500); // 每500ms更新一次，更平滑
        
        // 初始显示
        this.updateProgressDisplay(this.currentProgress);
    }
    
    // 智能进度模拟
    simulateProgress() {
        if (!this.isActive || this.currentProgress >= 100) return;
        
        // 计算增量
        const increment = this.calculateProgressIncrement();
        const newProgress = this.currentProgress + increment;
        
        // 设置上限：如果有服务器进度，不超过服务器进度+25%；否则根据阶段设置合理上限
        let maxAllowed = 95;
        if (this.serverProgress > 0) {
            maxAllowed = Math.min(this.serverProgress + 25, 95);
        } else {
            // 没有服务器进度时，根据阶段设置合理的初始上限
            const stageMaxLimits = {
                'preparing': 8,      // 准备阶段最多到8%
                'uploading': 14,     // 上传阶段最多到14%
                'parsing': 15,       // 解析阶段最多到15%
                'downloading': 25,   // 下载阶段最多到25%
                'transcribing': 35,  // 转录阶段最多到35%
                'optimizing': 55,    // 优化阶段最多到55%
                'summarizing': 75,   // 摘要阶段最多到75%
                'translating': 85,   // 翻译阶段最多到85%
                'complete': 100      // 完成阶段到100%
            };
            maxAllowed = stageMaxLimits[this.currentStage] || 95;
        }
        
        this.currentProgress = Math.min(newProgress, maxAllowed);
        
        // 更新显示
        this.updateProgressDisplay(this.currentProgress);
    }
    
    // 计算进度增量
    calculateProgressIncrement() {
        const stageMultipliers = {
            'preparing': 0.6,     // 准备阶段中等速度
            'uploading': 0.6,     // 上传阶段较快
            'parsing': 0.8,       // 解析阶段较快
            'downloading': 0.3,   // 下载阶段较慢
            'transcribing': 0.2,  // 转录阶段最慢
            'optimizing': 0.5,    // 优化阶段中等
            'summarizing': 0.4,   // 摘要阶段中等
            'translating': 0.3,   // 翻译阶段较慢
            'complete': 0         // 完成阶段不增长
        };
        
        const baseIncrement = 0.5; // 基础增量
        const multiplier = stageMultipliers[this.currentStage] || 0.3;
        const randomFactor = 0.5 + Math.random() * 0.5; // 0.5-1.0的随机因子
        
        return baseIncrement * multiplier * randomFactor;
}

// 停止进度模拟
    stopSmartProgress() {
        this.isActive = false;
        
        if (this.smartProgress.interval) {
            clearInterval(this.smartProgress.interval);
            this.smartProgress.interval = null;
        }
        
        // 设置为完成状态
        this.currentProgress = 100;
        this.currentStage = 'complete';
        this.updateProgressDisplay(100);
        
        console.log('🏁 进度模拟已停止');
    }
    
    // 重置进度条
    reset() {
        this.stopSmartProgress();
        this.currentProgress = 5;
        this.serverProgress = 0;
        this.currentStage = 'preparing';
        this.smartProgress.lastServerUpdate = 0;
        this.updateProgressDisplay(5);
    }
}

// 全局进度条实例
let smartProgressBar = null;

// 初始化进度条
function initializeProgressBar() {
    smartProgressBar = new SmartProgressBar();
}

// 兼容性函数 - 保持与现有代码的接口
function startProgressSimulation(audioDuration = null) {
    if (!smartProgressBar) initializeProgressBar();
    smartProgressBar.startSmartProgress(audioDuration);
}

function stopProgressSimulation() {
    if (smartProgressBar) {
        smartProgressBar.stopSmartProgress();
    }
}

// 显示结果内容
function showResultsContent(data, operation = 'transcribe_only') {
    lastResultData = {
        ...data,
        sourceMode: data.sourceMode || selectedSourceMode
    };
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('resultsContent').classList.remove('hidden');
    
    // 显示播客标题（如果有）
    const podcastTitleSection = document.getElementById('podcastTitleSection');
    if (data.podcastTitle) {
        const podcastTitleText = document.getElementById('podcastTitleText');
        
        podcastTitleText.textContent = data.podcastTitle;
        podcastTitleSection.classList.remove('hidden');
    } else {
        podcastTitleSection.classList.add('hidden');
    }
    
    // 准备标签页数据
    const tabs = [];
    
    // 转录文本标签（总是有）
    tabs.push({
        id: 'transcript',
        icon: '📝',
        title: currentLang === 'zh' ? '转录文本' : 'Transcript',
        content: data.transcript || 'No transcript available',
        contentId: 'transcriptTabContent'
    });

    // AI总结标签（如果有）
    if (data.summary) {
        tabs.push({
            id: 'summary',
            icon: '🤖',
            title: currentLang === 'zh' ? 'AI总结' : 'AI Summary',
            content: data.summary,
            contentId: 'summaryTabContent'
        });
    }
    
    // 翻译标签（如果需要且有翻译内容）
    if (data.needsTranslation && data.translation) {
        tabs.push({
            id: 'translation',
            icon: '🌍',
            title: currentLang === 'zh' ? '翻译' : 'Translation',
            content: data.translation,
            contentId: 'translationTabContent'
        });
        console.log('🌍 显示翻译内容');
    } else {
        console.log('✅ 无需显示翻译');
    }
    
    // 创建标签页导航
    createTabNavigation(tabs);
    
    // 填充标签页内容
    populateTabContent(tabs);
    
    // 激活转录标签页作为默认视图
    if (tabs.length > 0) {
        const defaultTab = tabs.find(tab => tab.id === 'transcript') || tabs[0];
        activateTab(defaultTab.id);
    }
    
    // 显示下载按钮（如果有保存的文件）
    showDownloadButtons(data.savedFiles || []);
    updateResultMeta(lastResultData);
    updateActionButtons();
    
    // 重新启用提交按钮
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
}

// 显示错误状态
function showError(errorMessage) {
    lastResultData = null;
    activeTabId = null;
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('resultsContent').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('resultMetaBar').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    
    const errorDetails = document.getElementById('errorDetails');
    errorDetails.textContent = errorMessage;
    updateActionButtons();
    
    // 重新启用提交按钮
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
}

function updateDesktopChrome() {
    const texts = translations[currentLang];
    const modeChip = document.getElementById('desktopModeChip');
    const statusText = document.getElementById('desktopStatusText');

    if (modeChip) {
        modeChip.innerHTML = `<strong>${desktopState.isDesktop ? texts.desktopModeApp : texts.desktopModeWeb}</strong>`;
    }

    if (statusText) {
        statusText.textContent = desktopState.isDesktop ? texts.desktopStatusApp : texts.desktopStatusWeb;
    }
}

function updateResultMeta(data) {
    const metaBar = document.getElementById('resultMetaBar');
    const texts = translations[currentLang];

    if (!metaBar || !data) {
        metaBar?.classList.add('hidden');
        ['resultMetaSource', 'resultMetaLanguage', 'resultMetaDuration', 'resultMetaFiles'].forEach((id) => {
            document.getElementById(id)?.classList.add('hidden');
        });
        return;
    }

    const metaItems = [
        {
            id: 'resultMetaSource',
            value: (data.sourceMode || selectedSourceMode) === 'file' ? texts.localSourceLabel : texts.remoteSourceLabel
        },
        {
            id: 'resultMetaLanguage',
            value: data.detectedLanguage ? `${texts.languageLabel}: ${String(data.detectedLanguage).toUpperCase()}` : null
        },
        {
            id: 'resultMetaDuration',
            value: formatDurationLabel(data.actualDuration || data.estimatedDuration)
                ? `${texts.durationLabel}: ${formatDurationLabel(data.actualDuration || data.estimatedDuration)}`
                : null
        },
        {
            id: 'resultMetaFiles',
            value: data.savedFiles?.length ? `${texts.fileCountLabel}: ${data.savedFiles.length}` : null
        }
    ];

    let hasVisibleItems = false;
    metaItems.forEach(({ id, value }) => {
        const element = document.getElementById(id);
        if (!element) return;

        if (value) {
            element.textContent = value;
            element.classList.remove('hidden');
            hasVisibleItems = true;
        } else {
            element.classList.add('hidden');
        }
    });

    metaBar.classList.toggle('hidden', !hasVisibleItems);
}

function getSavedFileForActiveTab() {
    if (!lastResultData?.savedFiles?.length) {
        return null;
    }

    const preferredType = activeTabId === 'summary'
        ? 'summary'
        : activeTabId === 'translation'
            ? 'translation'
            : 'transcript';

    return lastResultData.savedFiles.find((file) => file.type === preferredType)
        || lastResultData.savedFiles.find((file) => file.type === 'transcript')
        || lastResultData.savedFiles[0];
}

function updateActionButtons() {
    const copyButton = document.getElementById('copyActiveTabBtn');
    const revealButton = document.getElementById('revealSavedFileBtn');

    if (copyButton) {
        copyButton.classList.toggle('hidden', !(lastResultData && activeTabId));
    }

    if (revealButton) {
        const hasRevealedTarget = Boolean(desktopState.isDesktop && getSavedFileForActiveTab()?.path);
        revealButton.classList.toggle('hidden', !hasRevealedTarget);
    }
}

async function copyActiveTabContent() {
    const activeContent = document.querySelector('.tab-content:not(.hidden) .prose');
    if (!activeContent) {
        return;
    }

    const text = activeContent.innerText.trim();
    if (!text) {
        return;
    }

    await navigator.clipboard.writeText(text);

    const button = document.getElementById('copyActiveTabBtn');
    const label = document.getElementById('copyActiveText');
    if (button && label) {
        const originalLabel = translations[currentLang].copyActiveText;
        label.textContent = translations[currentLang].copySuccess;
        button.disabled = true;

        setTimeout(() => {
            label.textContent = originalLabel;
            button.disabled = false;
        }, 1500);
    }
}

async function revealSavedFile() {
    const bridge = getDesktopBridge();
    const file = getSavedFileForActiveTab();

    if (!bridge || !desktopState.isDesktop || !file?.path) {
        return;
    }

    try {
        await bridge.revealPath(file.path);
    } catch (error) {
        console.warn('Failed to reveal saved file:', error);
    }
}

// 验证播客链接格式
function validatePodcastUrl(url) {
    // Apple Podcasts URL pattern
    const applePodcastsPattern = /^https:\/\/podcasts\.apple\.com\//;
    // 小宇宙 URL pattern (修正域名)
    const xiaoyuzhouPattern = /^https:\/\/(www\.)?xiaoyuzhoufm\.com\//;
    // 通用音频文件URL
    const audioFilePattern = /\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i;
    
    return applePodcastsPattern.test(url) || 
           xiaoyuzhouPattern.test(url) || 
           audioFilePattern.test(url) ||
           url.includes('podcast') ||
           url.includes('audio');
}

// 表单验证
document.getElementById('podcastUrl').addEventListener('input', function(e) {
    const url = e.target.value;
    if (url && !validatePodcastUrl(url)) {
        e.target.setCustomValidity(currentLang === 'zh' 
            ? '请输入有效的播客链接' 
            : 'Please enter a valid podcast link');
    } else {
        e.target.setCustomValidity('');
    }
});

// 监听操作类型变化的函数（将在主初始化中调用）
function setupOperationTypeListeners() {
    const operationRadios = document.querySelectorAll('input[name="operation"]');
    const syncOperationState = (selectedValue) => {
        const outputLanguageContainer = document.getElementById('outputLanguage').closest('div');

        operationRadios.forEach((radio) => {
            radio.closest('.source-option')?.classList.toggle('active', radio.value === selectedValue);
        });

        if (selectedValue === 'transcribe_only') {
            outputLanguageContainer.style.opacity = '0.5';
            document.getElementById('outputLanguage').disabled = true;
        } else {
            outputLanguageContainer.style.opacity = '1';
            document.getElementById('outputLanguage').disabled = false;
        }
    };

    operationRadios.forEach((radio) => {
        radio.addEventListener('change', function() {
            syncOperationState(this.value);
        });
    });

    const activeValue = document.querySelector('input[name="operation"]:checked')?.value || 'transcribe_summarize';
    syncOperationState(activeValue);
}

function setupSourceModeListeners() {
    const sourceRadios = document.querySelectorAll('input[name="sourceMode"]');
    sourceRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            selectedSourceMode = radio.value;
            updateSourceModeUI();
        });
    });

    updateSourceModeUI();
}

function updateSourceModeUI() {
    const urlSection = document.getElementById('urlSourceSection');
    const fileSection = document.getElementById('fileSourceSection');
    const urlInput = document.getElementById('podcastUrl');
    const fileInput = document.getElementById('audioFileInput');

    selectedSourceMode = document.querySelector('input[name="sourceMode"]:checked')?.value || 'url';

    urlSection?.classList.toggle('hidden', selectedSourceMode !== 'url');
    fileSection?.classList.toggle('hidden', selectedSourceMode !== 'file');

    if (urlInput) {
        urlInput.disabled = selectedSourceMode !== 'url';
        urlInput.required = selectedSourceMode === 'url';
    }

    if (fileInput) {
        fileInput.disabled = selectedSourceMode !== 'file';
    }

    document.querySelectorAll('[data-source-option]').forEach((option) => {
        option.classList.toggle('active', option.dataset.sourceOption === selectedSourceMode);
    });
}

function isSupportedAudioFile(file) {
    if (!file) {
        return false;
    }

    if (file.type?.startsWith('audio/')) {
        return true;
    }

    return /\.(mp3|m4a|wav|aac|ogg|flac|mp4|webm)$/i.test(file.name || '');
}

function setupAudioFilePicker() {
    const pickButton = document.getElementById('pickAudioButton');
    const clearButton = document.getElementById('clearSelectedFile');
    const fileInput = document.getElementById('audioFileInput');
    const fileDropzone = document.getElementById('fileDropzone');

    pickButton?.addEventListener('click', () => fileInput?.click());
    clearButton?.addEventListener('click', clearSelectedAudioFile);

    fileInput?.addEventListener('change', (event) => {
        handleAudioFileSelection(event.target.files);
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
        fileDropzone?.addEventListener(eventName, (event) => {
            event.preventDefault();
            fileDropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'dragend'].forEach((eventName) => {
        fileDropzone?.addEventListener(eventName, () => {
            fileDropzone.classList.remove('dragover');
        });
    });

    fileDropzone?.addEventListener('drop', (event) => {
        event.preventDefault();
        fileDropzone.classList.remove('dragover');
        handleAudioFileSelection(event.dataTransfer?.files);
    });
}

function handleAudioFileSelection(fileList) {
    const file = fileList?.[0];
    if (!file) {
        return;
    }

    if (!isSupportedAudioFile(file)) {
        showError(currentLang === 'zh' ? '请选择支持的音频文件格式' : 'Please choose a supported audio file');
        return;
    }

    selectedAudioFile = file;
    updateSelectedFileCard();
}

function clearSelectedAudioFile() {
    selectedAudioFile = null;
    const fileInput = document.getElementById('audioFileInput');
    if (fileInput) {
        fileInput.value = '';
    }
    updateSelectedFileCard();
}

function updateSelectedFileCard() {
    const card = document.getElementById('selectedFileCard');
    const name = document.getElementById('selectedFileName');
    const meta = document.getElementById('selectedFileMeta');
    const clearButton = document.getElementById('clearSelectedFile');
    const label = document.getElementById('selectedFileLabel');

    if (label) {
        label.textContent = translations[currentLang].selectedFileLabel;
    }

    if (!card || !name || !meta || !clearButton) {
        return;
    }

    if (!selectedAudioFile) {
        card.classList.add('hidden');
        clearButton.classList.add('hidden');
        return;
    }

    name.textContent = selectedAudioFile.name;
    meta.textContent = `${translations[currentLang].localFileReady} • ${formatFileSize(selectedAudioFile.size)}`;
    card.classList.remove('hidden');
    clearButton.classList.remove('hidden');
}

function setupWorkspaceActions() {
    document.getElementById('copyActiveTabBtn')?.addEventListener('click', async () => {
        try {
            await copyActiveTabContent();
        } catch (error) {
            console.warn('Copy failed:', error);
        }
    });

    document.getElementById('revealSavedFileBtn')?.addEventListener('click', async () => {
        await revealSavedFile();
    });
}

// 显示下载按钮
function showDownloadButtons(savedFiles) {
    const downloadSection = document.getElementById('downloadSection');
    const downloadButtons = document.getElementById('downloadButtons');
    
    if (!savedFiles || savedFiles.length === 0) {
        downloadSection.classList.add('hidden');
        return;
    }
    
    // 清空之前的链接
    downloadButtons.innerHTML = '';
    
    // 为每个保存的文件创建下载链接（过滤掉原始转录）
    savedFiles.forEach(file => {
        // 只显示优化后的转录和AI总结，不显示原始转录
        if (file.type === 'original_transcript') {
            return; // 跳过原始转录文件
        }
        
        const link = document.createElement('a');
        link.href = `/api/download/${file.filename}`;
        link.download = file.filename;
        link.className = 'download-button no-underline';
        
        const buttonTextMap = {
            transcript: currentLang === 'zh' ? '下载转录稿' : 'Download transcript',
            summary: currentLang === 'zh' ? '下载总结' : 'Download summary',
            translation: currentLang === 'zh' ? '下载翻译' : 'Download translation'
        };
        
        const buttonText = buttonTextMap[file.type] || `Download ${file.type}`;
        
        // 创建文本内容
        const textSpan = document.createElement('span');
        textSpan.textContent = `${buttonText} · ${formatFileSize(file.size || 0)}`;
        
        // 添加到链接中
        link.appendChild(textSpan);
        
        downloadButtons.appendChild(link);
    });
    
    // 显示下载区域
    downloadSection.classList.remove('hidden');
}

// 更新下载按钮的语言
function updateDownloadButtonsLanguage() {
    if (lastResultData?.savedFiles?.length) {
        showDownloadButtons(lastResultData.savedFiles);
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 语言切换功能已在上方定义，此处移除重复

// 更新语言切换按钮
function updateLanguageToggle() {
    const toggle = document.getElementById('languageToggle');
    const texts = translations[currentLang];
    if (toggle && texts) {
        toggle.innerHTML = `<span class="mr-2">${texts.langFlag}</span>${texts.langText}`;
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 设置正确的语言属性
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    
    // 根据浏览器语言设置总结语言的默认值
    const outputLanguageSelect = document.getElementById('outputLanguage');
    if (outputLanguageSelect) {
        outputLanguageSelect.value = currentLang; // 使用浏览器检测的语言
    }
    
    updateUI();
    updateLanguageToggle();
    
    // 设置操作类型监听器
    setupOperationTypeListeners();
    setupSourceModeListeners();
    setupAudioFilePicker();
    setupWorkspaceActions();
    await initializeDesktopMode();
});

// 移除了自动检查已完成文件的功能，让用户每次都有干净的开始

// 标签页相关函数
function createTabNavigation(tabs) {
    const tabNavigation = document.getElementById('tabNavigation');
    tabNavigation.innerHTML = '';
    
    tabs.forEach(tab => {
        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        tabButton.type = 'button';
        tabButton.setAttribute('data-tab', tab.id);
        tabButton.innerHTML = `
            <span>${tab.icon}</span>
            <span>${tab.title}</span>
        `;
        
        tabButton.addEventListener('click', () => activateTab(tab.id));
        tabNavigation.appendChild(tabButton);
    });
}

function populateTabContent(tabs) {
    tabs.forEach(tab => {
        const contentElement = document.getElementById(tab.contentId);
        if (contentElement) {
            const textElement = contentElement.querySelector('.prose');
            if (textElement) {
                textElement.innerHTML = marked.parse(tab.content);
            }
        }
    });
}

function activateTab(tabId) {
    activeTabId = tabId;

    // 移除所有活动状态
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    // 激活选中的标签页
    const activeButton = document.querySelector(`[data-tab="${tabId}"]`);
    const activeContent = document.getElementById(`${tabId}TabContent`);
    
    if (activeButton && activeContent) {
        activeButton.classList.add('active');
        activeContent.classList.remove('hidden');
    }
    
    // 显示下载区域
    const downloadSection = document.getElementById('downloadSection');
    if (downloadSection) {
        downloadSection.classList.remove('hidden');
    }

    updateActionButtons();
}

// SSE 进度监听函数
function setupProgressListener(eventSource) {
    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'progress') {
                // 使用新的智能进度条系统
                if (smartProgressBar) {
                    smartProgressBar.updateProgress(data.progress, data.stageText, true);
                }
                
                console.log(`📊 收到进度更新: ${data.progress}% - ${data.stageText}`);
            } else if (data.type === 'connected') {
                console.log('✅ SSE连接已建立:', data.sessionId);
            }
        } catch (error) {
            console.error('解析SSE数据失败:', error);
        }
    };
    
    eventSource.onerror = function(error) {
        console.error('SSE连接错误:', error);
        eventSource.close();
    };
}

// 兼容性函数 - 更新进度显示
function updateProgressDisplay() {
    // 新系统中由 SmartProgressBar 内部处理
    if (smartProgressBar) {
        smartProgressBar.updateProgressDisplay(smartProgressBar.currentProgress);
    }
}
