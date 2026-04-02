import { useEffect, useRef, useState } from 'react';
import { FilePicker } from './FilePicker';
import { HistoryStrip } from './HistoryStrip';
import { SegmentedControl } from './ui/SegmentedControl';
import { asrBackendOptions, languageOptions, outputLanguageOptions } from '../lib/translations';

const HISTORY_PANEL_STORAGE_KEY = 'podcast-transcriber.sidebar-history-height';
const DEFAULT_HISTORY_PANEL_HEIGHT = 240;
const MIN_HISTORY_PANEL_HEIGHT = 152;
const MIN_CONFIG_PANEL_HEIGHT = 280;
const RESIZER_HEIGHT = 20;

export function SourceForm({
  text,
  currentLang,
  isDesktop = false,
  sourceMode,
  form,
  selectedFile,
  isBusy,
  historyItems,
  activeHistoryId,
  onSourceModeChange,
  onFormChange,
  onFileSelect,
  onFileClear,
  onSubmit,
  onHistorySelect,
  onHistoryDelete,
  onLanguageToggle
}) {
  const layoutRef = useRef(null);
  const dragStateRef = useRef(null);
  const urlOnlyAsrBackends = new Set(['fun_asr_file_diarization']);
  const hasHistory = Boolean(historyItems?.length);
  const [isResizingHistory, setIsResizingHistory] = useState(false);
  const [historyDockHeight, setHistoryDockHeight] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_HISTORY_PANEL_HEIGHT;
    }

    const savedHeight = Number(window.localStorage.getItem(HISTORY_PANEL_STORAGE_KEY));
    return Number.isFinite(savedHeight) ? savedHeight : DEFAULT_HISTORY_PANEL_HEIGHT;
  });
  const sourceOptions = [
    {
      value: 'url',
      title: text.sourceUrlTitle
    },
    {
      value: 'file',
      title: text.sourceFileTitle
    }
  ];

  const operationOptions = [
    {
      value: 'transcribe_summarize',
      title: text.summarizeOption
    },
    {
      value: 'transcribe_only',
      title: text.transcribeOption
    }
  ];

  const selectThemeClass = 'surface-select-dark';
  const inputThemeClass = 'surface-input-dark';
  const helperTextClass = 'sidebar-helper-text';
  const visibleAsrBackendOptions = asrBackendOptions.map((option) => ({
    ...option,
    disabled: sourceMode === 'file' && urlOnlyAsrBackends.has(option.value)
  }));

  function clampHistoryHeight(nextHeight, containerHeight = layoutRef.current?.clientHeight || 0) {
    if (!containerHeight) {
      return Math.max(MIN_HISTORY_PANEL_HEIGHT, Math.round(nextHeight));
    }

    const maxHeight = Math.max(
      MIN_HISTORY_PANEL_HEIGHT,
      Math.round(containerHeight - MIN_CONFIG_PANEL_HEIGHT - RESIZER_HEIGHT)
    );

    return Math.min(maxHeight, Math.max(MIN_HISTORY_PANEL_HEIGHT, Math.round(nextHeight)));
  }

  useEffect(() => {
    if (!hasHistory || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(HISTORY_PANEL_STORAGE_KEY, String(historyDockHeight));
  }, [hasHistory, historyDockHeight]);

  useEffect(() => {
    if (!hasHistory || typeof ResizeObserver === 'undefined' || !layoutRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const nextContainerHeight = entry?.contentRect?.height || layoutRef.current?.clientHeight || 0;
      if (!nextContainerHeight) {
        return;
      }

      setHistoryDockHeight((current) => clampHistoryHeight(current, nextContainerHeight));
    });

    observer.observe(layoutRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasHistory]);

  useEffect(() => {
    if (!hasHistory) {
      dragStateRef.current = null;
      setIsResizingHistory(false);
    }
  }, [hasHistory]);

  useEffect(() => {
    if (!isResizingHistory) {
      return undefined;
    }

    function stopResize() {
      dragStateRef.current = null;
      setIsResizingHistory(false);
    }

    function handlePointerMove(event) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      setHistoryDockHeight(clampHistoryHeight(dragState.containerBottom - event.clientY, dragState.containerHeight));
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    window.addEventListener('blur', stopResize);

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      window.removeEventListener('blur', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingHistory]);

  function handleHistoryResizeStart(event) {
    if (!hasHistory || event.button !== 0 || !layoutRef.current) {
      return;
    }

    event.preventDefault();

    const rect = layoutRef.current.getBoundingClientRect();
    dragStateRef.current = {
      containerBottom: rect.bottom,
      containerHeight: rect.height
    };
    setIsResizingHistory(true);
  }

  function handleHistoryResizeKeyDown(event) {
    if (!hasHistory) {
      return;
    }

    const containerHeight = layoutRef.current?.clientHeight || 0;
    const maxHeight = Math.max(MIN_HISTORY_PANEL_HEIGHT, Math.round(containerHeight - MIN_CONFIG_PANEL_HEIGHT - RESIZER_HEIGHT));

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHistoryDockHeight((current) => clampHistoryHeight(current + 24, containerHeight));
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHistoryDockHeight((current) => clampHistoryHeight(current - 24, containerHeight));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setHistoryDockHeight(MIN_HISTORY_PANEL_HEIGHT);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setHistoryDockHeight(maxHeight);
    }
  }

  return (
    <aside className="control-card overflow-hidden lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)]">
      <div className="card-body-tight flex h-full min-h-0 flex-col gap-5">
        <div className={`space-y-3 border-b border-white/10 pb-4 ${isDesktop ? 'window-drag-region' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow-inverse">{text.controlLabel}</p>
            <button
              type="button"
              className={`sidebar-language-switch ${isDesktop ? 'window-no-drag' : ''}`}
              onClick={onLanguageToggle}
            >
              {currentLang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>
          <div className="space-y-1">
            <h2 className="sidebar-title">{text.controlTitle}</h2>
          </div>
        </div>

        <form className="sidebar-form" onSubmit={onSubmit}>
          <div ref={layoutRef} className="sidebar-stack">
            <section className="sidebar-block space-y-3">
              <label className="eyebrow-inverse">{text.sourceLabel}</label>
              <SegmentedControl
                name="sourceMode"
                value={sourceMode}
                options={sourceOptions}
                onChange={onSourceModeChange}
                tone="dark"
              />
            </section>

            {sourceMode === 'url' ? (
              <section className="sidebar-block space-y-3">
                <label className="eyebrow-inverse" htmlFor="podcast-url">
                  {text.urlLabel}
                </label>
                <input
                  id="podcast-url"
                  type="url"
                  className={inputThemeClass}
                  placeholder={text.urlPlaceholder}
                  value={form.url}
                  onChange={(event) => onFormChange('url', event.target.value)}
                  required
                />
                <p className={helperTextClass}>{text.urlHelper}</p>
              </section>
            ) : (
              <section className="sidebar-block space-y-3">
                <label className="eyebrow-inverse">{text.fileLabel}</label>
                <FilePicker
                  text={text}
                  selectedFile={selectedFile}
                  onSelectFile={onFileSelect}
                  onClearFile={onFileClear}
                />
              </section>
            )}

            <section className="sidebar-block space-y-3">
              <label className="eyebrow-inverse">{text.operationLabel}</label>
              <SegmentedControl
                name="operation"
                value={form.operation}
                options={operationOptions}
                onChange={(value) => onFormChange('operation', value)}
                tone="dark"
              />
            </section>

            <section className="sidebar-block grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 sm:col-span-2">
                <label className="eyebrow-inverse" htmlFor="asr-backend">
                  {text.asrBackend}
                </label>
                <select
                  id="asr-backend"
                  className={selectThemeClass}
                  value={form.asrBackend}
                  onChange={(event) => onFormChange('asrBackend', event.target.value)}
                >
                  {visibleAsrBackendOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                      {option[text.langKey]}
                    </option>
                  ))}
                </select>
                {sourceMode === 'file' ? (
                  <p className={helperTextClass}>{text.asrBackendFileHint}</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <label className="eyebrow-inverse" htmlFor="audio-language">
                  {text.audioLanguage}
                </label>
                <select
                  id="audio-language"
                  className={selectThemeClass}
                  value={form.audioLanguage}
                  onChange={(event) => onFormChange('audioLanguage', event.target.value)}
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option[text.langKey]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label className="eyebrow-inverse" htmlFor="output-language">
                  {text.outputLanguage}
                </label>
                <select
                  id="output-language"
                  className={selectThemeClass}
                  value={form.outputLanguage}
                  onChange={(event) => onFormChange('outputLanguage', event.target.value)}
                >
                  {outputLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option[text.langKey]}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="sidebar-block space-y-3">
              <label className="eyebrow-inverse" htmlFor="hotwords">
                {text.hotwords}
              </label>
              <textarea
                id="hotwords"
                className={inputThemeClass}
                rows={3}
                placeholder={text.hotwordsPlaceholder}
                value={form.hotwords}
                onChange={(event) => onFormChange('hotwords', event.target.value)}
              />
              <p className={helperTextClass}>{text.hotwordsHint}</p>
            </section>

            <section className="sidebar-block space-y-3">
              <label className="eyebrow-inverse" htmlFor="transcription-context">
                {text.transcriptionContext}
              </label>
              <textarea
                id="transcription-context"
                className={inputThemeClass}
                rows={3}
                placeholder={text.transcriptionContextPlaceholder}
                value={form.transcriptionContext}
                onChange={(event) => onFormChange('transcriptionContext', event.target.value)}
              />
              <p className={helperTextClass}>{text.transcriptionContextHint}</p>
            </section>
          </div>

          {hasHistory ? (
            <>
              <div
                className={`sidebar-resizer ${isResizingHistory ? 'sidebar-resizer-active' : ''}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label={text.historyLabel}
                tabIndex={0}
                onPointerDown={handleHistoryResizeStart}
                onKeyDown={handleHistoryResizeKeyDown}
              >
                <span className="sidebar-resizer-line" aria-hidden="true" />
                <span className="sidebar-resizer-handle" aria-hidden="true" />
              </div>

              <div
                className="sidebar-history-dock"
                style={{
                  flexBasis: `${historyDockHeight}px`,
                  maxHeight: 'none'
                }}
              >
              <div className="sidebar-history-shell">
                <HistoryStrip
                  text={text}
                  items={historyItems}
                  activeHistoryId={activeHistoryId}
                  onSelect={onHistorySelect}
                  onDelete={onHistoryDelete}
                  disabled={isBusy}
                  locale={text.langKey === 'zh' ? 'zh-CN' : 'en-US'}
                  layout="stack"
                  tone="dark"
                />
              </div>
              </div>
            </>
          ) : null}

          <div className="sidebar-submit-row">
            <button
              type="submit"
              className="btn btn-primary h-11 w-full shrink-0 rounded-xl normal-case"
              disabled={isBusy}
            >
              {isBusy ? text.processing : text.submit}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
