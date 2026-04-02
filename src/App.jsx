import { useEffect, useRef, useState } from 'react';
import { SourceForm } from './components/SourceForm';
import { ResultWorkspace } from './components/ResultWorkspace';
import {
  deleteHistoryResult,
  estimateRemoteDuration,
  fetchHistory,
  fetchHistoryResult,
  fetchLatestResult,
  processLocalAudio,
  processRemoteAudio,
  uploadLocalAudioFile
} from './lib/api';
import {
  detectBrowserLanguage,
  formatElapsedLabel,
  estimateDurationFromFileSize,
  formatDurationLabel,
  generateSessionId,
  getPreferredTheme,
  normalizeErrorMessage,
  persistLanguage,
  validatePodcastUrl
} from './lib/utils';
import { translations } from './lib/translations';

const LANG_KEY_MAP = {
  zh: 'zh',
  en: 'en'
};

const URL_ONLY_ASR_BACKENDS = new Set(['fun_asr_file_diarization']);

function getProgressLabel(lang, payload) {
  if (payload?.stageText) {
    return payload.stageText;
  }

  return translations[lang].loadingHint;
}

function getSavedFileForActiveTab(result, activeTab) {
  if (!result?.savedFiles?.length) {
    return null;
  }

  const preferredType =
    activeTab === 'summary'
      ? 'summary'
      : activeTab === 'translation'
        ? 'translation'
        : 'transcript';

  return (
    result.savedFiles.find((file) => file.type === preferredType) ||
    result.savedFiles.find((file) => file.type === 'transcript') ||
    result.savedFiles[0]
  );
}

export default function App() {
  const initialLanguage = detectBrowserLanguage();
  const [currentLang, setCurrentLang] = useState(initialLanguage);
  const [desktopState, setDesktopState] = useState({
    isDesktop: false,
    tempDir: null,
    resultsRoot: null
  });
  const [sourceMode, setSourceMode] = useState('url');
  const [form, setForm] = useState({
    url: '',
    operation: 'transcribe_summarize',
    asrBackend: 'auto',
    audioLanguage: 'auto',
    outputLanguage: initialLanguage === 'zh' ? 'zh' : 'en',
    hotwords: '',
    transcriptionContext: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [activeTab, setActiveTab] = useState('transcript');
  const [progress, setProgress] = useState({
    value: 0,
    label: translations[initialLanguage].loadingHint,
    stage: null,
    elapsedLabel: null,
    remainingLabel: null
  });
  const eventSourceRef = useRef(null);
  const progressTimerRef = useRef(null);
  const latestServerProgressRef = useRef(0);
  const historySelectionRequestRef = useRef(0);

  const text = {
    ...translations[currentLang],
    langKey: LANG_KEY_MAP[currentLang]
  };

  useEffect(() => {
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  }, [currentLang]);

  useEffect(() => {
    function applyTheme() {
      document.documentElement.dataset.theme = getPreferredTheme();
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const bridge = window.desktopApp;

    if (!bridge) {
      return undefined;
    }

    bridge
      .getState()
      .then((state) => {
        if (!disposed) {
          setDesktopState(state);
        }
      })
      .catch(() => {
        if (!disposed) {
          setDesktopState({
            isDesktop: false,
            tempDir: null,
            resultsRoot: null
          });
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      stopProgressTracking();
      closeEventSource();
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    Promise.all([fetchLatestResult(), fetchHistory()])
      .then(async ([latestResult, history]) => {
        if (disposed) {
          return;
        }

        setHistoryItems(history);
        if (latestResult) {
          applyResult(latestResult);
          return;
        }

        const fallbackHistoryId = history[0]?.id || null;
        if (!fallbackHistoryId) {
          return;
        }

        setActiveHistoryId(fallbackHistoryId);
        const requestId = ++historySelectionRequestRef.current;

        try {
          const fallbackResult = await fetchHistoryResult(fallbackHistoryId);
          if (!disposed && historySelectionRequestRef.current === requestId) {
            applyResult(fallbackResult);
          }
        } catch (_error) {
          if (!disposed && historySelectionRequestRef.current === requestId) {
            setStatus('error');
          }
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, []);

  function closeEventSource() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function stopProgressTracking() {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function startProgressTracking(estimatedDuration) {
    stopProgressTracking();
    latestServerProgressRef.current = 0;
    const startedAt = Date.now();
    setProgress({
      value: 4,
      label: text.loadingHint,
      stage: 'queued',
      elapsedLabel: formatElapsedLabel(0),
      remainingLabel: estimatedDuration ? formatElapsedLabel(estimatedDuration) : null
    });

    const baseline = estimatedDuration ? Math.max(35, Math.min(80, estimatedDuration / 12)) : 48;

    progressTimerRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

      setProgress((current) => {
        const floor = latestServerProgressRef.current;
        const currentValue = Math.max(current.value, floor);

        if (currentValue >= 94) {
          return {
            ...current,
            value: currentValue,
            elapsedLabel: formatElapsedLabel(elapsedSeconds),
            remainingLabel: estimatedDuration ? formatElapsedLabel(Math.max(0, estimatedDuration - elapsedSeconds)) : null
          };
        }

        const delta = currentValue < 18 ? 2 : currentValue < 48 ? 1.2 : currentValue < 78 ? 0.65 : 0.3;
        const nextValue = Math.min(94, Math.max(floor, currentValue + delta + baseline / 1000));
        const remainingSeconds = estimatedDuration
          ? Math.max(0, Math.round(estimatedDuration * ((100 - nextValue) / 100)))
          : null;

        return {
          ...current,
          value: Number(nextValue.toFixed(1)),
          elapsedLabel: formatElapsedLabel(elapsedSeconds),
          remainingLabel: remainingSeconds !== null ? formatElapsedLabel(remainingSeconds) : null
        };
      });
    }, 900);
  }

  function openProgressConnection(sessionId) {
    closeEventSource();

    try {
      const eventSource = new EventSource(`/api/progress/${sessionId}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const payload = JSON.parse(event.data);

        if (payload.type !== 'progress') {
          return;
        }

        latestServerProgressRef.current = payload.progress || 0;
        setProgress((current) => ({
          ...current,
          value: payload.progress || 0,
          label: getProgressLabel(currentLang, payload),
          stage: payload.stage || current.stage
        }));
      };

      eventSource.onerror = () => {
        closeEventSource();
      };
    } catch (_error) {
      closeEventSource();
    }
  }

  function resetRunState() {
    setStatus('loading');
    setErrorMessage('');
  }

  function applyResult(data) {
    const nextResult = {
      ...data,
      sourceMode: data.sourceMode || sourceMode,
      durationLabel: formatDurationLabel(data.actualDuration || data.estimatedDuration)
    };

    const activeFile = getSavedFileForActiveTab(nextResult, 'transcript');
    nextResult.activeFilePath = activeFile?.path || null;

    setResult(nextResult);
    setActiveHistoryId(nextResult.historyId || null);
    setActiveTab('transcript');
    setStatus('success');
    setErrorMessage('');
  }

  async function syncHistory() {
    try {
      const items = await fetchHistory();
      setHistoryItems(items);
    } catch (_error) {
      // noop
    }
  }

  function handleFormChange(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleLanguageToggle() {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    persistLanguage(nextLang);
    setCurrentLang(nextLang);
    setProgress((current) => ({
      ...current,
      label: translations[nextLang].loadingHint
    }));
  }

  function handleSourceModeChange(mode) {
    setSourceMode(mode);
    if (mode === 'file' && URL_ONLY_ASR_BACKENDS.has(form.asrBackend)) {
      setForm((current) => ({
        ...current,
        asrBackend: 'auto'
      }));
    }
    if (mode === 'url') {
      setSelectedFile(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (sourceMode === 'url') {
      const trimmedUrl = form.url.trim();
      if (!trimmedUrl || !validatePodcastUrl(trimmedUrl)) {
        setStatus('error');
        setErrorMessage(text.invalidUrl);
        return;
      }
    }

    if (sourceMode === 'file' && !selectedFile) {
      setStatus('error');
      setErrorMessage(text.fileRequired);
      return;
    }

    const sessionId = generateSessionId();
    const payload = {
      operation: form.operation,
      asrBackend: form.asrBackend,
      audioLanguage: form.audioLanguage,
      outputLanguage: form.outputLanguage,
      hotwords: form.hotwords,
      transcriptionContext: form.transcriptionContext,
      sessionId
    };

    if (sourceMode === 'url') {
      payload.url = form.url.trim();
    }

    resetRunState();
    openProgressConnection(sessionId);

    try {
      let estimatedDuration = null;

      if (sourceMode === 'url') {
        estimatedDuration = await estimateRemoteDuration(payload.url);
      } else if (selectedFile) {
        estimatedDuration = estimateDurationFromFileSize(selectedFile.size);
      }

      startProgressTracking(estimatedDuration);

      let response;
      if (sourceMode === 'file' && selectedFile) {
        const uploadResult = await uploadLocalAudioFile(selectedFile, sessionId);
        response = await processLocalAudio({
          ...payload,
          filename: uploadResult.filename,
          originalName: uploadResult.originalName || selectedFile.name
        });
      } else {
        response = await processRemoteAudio(payload);
      }

      stopProgressTracking();
      closeEventSource();
      setProgress((current) => ({
        ...current,
        value: 100,
        label: text.processing,
        stage: 'complete',
        remainingLabel: formatElapsedLabel(0)
      }));

      if (!response.success) {
        throw new Error(response.error || text.genericError);
      }

      applyResult(response.data);
      syncHistory();
    } catch (error) {
      stopProgressTracking();
      closeEventSource();
      setStatus('error');
      setErrorMessage(normalizeErrorMessage(error, text.genericError));
    }
  }

  function handleTabChange(tabId) {
    const nextFile = getSavedFileForActiveTab(result, tabId);
    setActiveTab(tabId);
    setResult((current) =>
      current
        ? {
            ...current,
            activeFilePath: nextFile?.path || null
          }
        : current
    );
  }

  async function handleHistorySelect(historyId) {
    if (!historyId) {
      return;
    }

    setActiveHistoryId(historyId);
    const requestId = ++historySelectionRequestRef.current;

    try {
      const historyResult = await fetchHistoryResult(historyId);
      if (historySelectionRequestRef.current !== requestId) {
        return;
      }
      applyResult(historyResult);
    } catch (error) {
      if (historySelectionRequestRef.current !== requestId) {
        return;
      }
      setStatus('error');
      setErrorMessage(normalizeErrorMessage(error, text.genericError));
    }
  }

  async function handleHistoryDelete(historyId) {
    if (!historyId) {
      return;
    }
    const deletingActiveResult = activeHistoryId === historyId || result?.historyId === historyId;
    historySelectionRequestRef.current += 1;

    try {
      const deleteResult = await deleteHistoryResult(historyId);
      const nextItems = await fetchHistory();
      setHistoryItems(nextItems);

      if (!deletingActiveResult) {
        return;
      }

      const nextHistoryId = deleteResult.nextHistoryId || nextItems[0]?.id || null;
      if (!nextHistoryId) {
        setResult(null);
        setActiveHistoryId(null);
        setActiveTab('transcript');
        setStatus('idle');
        setErrorMessage('');
        return;
      }

      setActiveHistoryId(nextHistoryId);
      const nextHistoryResult = await fetchHistoryResult(nextHistoryId);
      applyResult(nextHistoryResult);
    } catch (error) {
      setStatus('error');
      setErrorMessage(normalizeErrorMessage(error, text.genericError));
      syncHistory();
    }
  }

  async function handleCopy() {
    if (!result) {
      return;
    }

    const savedFile = getSavedFileForActiveTab(result, activeTab);
    const tabContent =
      activeTab === 'summary'
        ? result.summary
        : activeTab === 'translation'
          ? result.translation
          : result.transcript;

    const content = tabContent || savedFile?.content || '';
    if (!content) {
      return;
    }

    await navigator.clipboard.writeText(content);
  }

  async function handleReveal() {
    const bridge = window.desktopApp;
    if (!bridge || !desktopState.isDesktop || !desktopState.resultsRoot) {
      return;
    }

    try {
      const targetDir = result?.activeFilePath
        ? result.activeFilePath.replace(/[/\\][^/\\]+$/, '')
        : desktopState.resultsRoot;
      await bridge.revealPath(targetDir || desktopState.resultsRoot);
    } catch (_error) {
      // noop
    }
  }

  async function handleToggleMaximize() {
    const bridge = window.desktopApp;
    if (!bridge || !desktopState.isDesktop) {
      return;
    }

    try {
      const nextState = await bridge.toggleMaximize();
      if (nextState?.ok) {
        setDesktopState((current) => ({
          ...current,
          isMaximized: Boolean(nextState.isMaximized)
        }));
      }
    } catch (_error) {
      // noop
    }
  }

  return (
    <div className="app-shell">
      <div className="workspace-grid">
        <SourceForm
          text={text}
          currentLang={currentLang}
          isDesktop={desktopState.isDesktop}
          sourceMode={sourceMode}
          form={form}
          selectedFile={selectedFile}
          isBusy={status === 'loading'}
          historyItems={historyItems}
          activeHistoryId={activeHistoryId}
          onSourceModeChange={handleSourceModeChange}
          onFormChange={handleFormChange}
          onFileSelect={setSelectedFile}
          onFileClear={() => setSelectedFile(null)}
          onSubmit={handleSubmit}
          onHistorySelect={handleHistorySelect}
          onHistoryDelete={handleHistoryDelete}
          onLanguageToggle={handleLanguageToggle}
        />

        <div className="main-panel">
          <header
            className={`main-toolbar ${desktopState.isDesktop ? 'window-drag-region' : ''}`}
            onDoubleClick={desktopState.isDesktop ? handleToggleMaximize : undefined}
          >
            <p className="eyebrow">{text.resultLabel}</p>
            <div
              className={`toolbar-actions ${desktopState.isDesktop ? 'window-no-drag' : ''}`}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {result && desktopState.isDesktop && desktopState.resultsRoot ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline rounded-xl normal-case"
                  onClick={handleReveal}
                >
                  {text.revealFile}
                </button>
              ) : null}
            </div>
          </header>
          <ResultWorkspace
            text={text}
            status={status}
            errorMessage={errorMessage}
            progress={progress}
            result={result}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onCopy={handleCopy}
          />
        </div>
      </div>
    </div>
  );
}
