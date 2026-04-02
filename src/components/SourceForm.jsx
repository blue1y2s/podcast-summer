import { FilePicker } from './FilePicker';
import { HistoryStrip } from './HistoryStrip';
import { SegmentedControl } from './ui/SegmentedControl';
import { asrBackendOptions, languageOptions, outputLanguageOptions } from '../lib/translations';

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
  const urlOnlyAsrBackends = new Set(['fun_asr_file_diarization']);
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
  const visibleAsrBackendOptions = asrBackendOptions.map((option) => ({
    ...option,
    disabled: sourceMode === 'file' && urlOnlyAsrBackends.has(option.value)
  }));

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

        <form className="flex h-full min-h-0 flex-col gap-4 overflow-hidden" onSubmit={onSubmit}>
          <div className="sidebar-scroll-pane">
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
                <p className="text-xs leading-6 text-base-content/55">{text.urlHelper}</p>
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
                  <p className="text-xs leading-6 text-base-content/55">{text.asrBackendFileHint}</p>
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
              <p className="text-xs leading-6 text-base-content/55">{text.hotwordsHint}</p>
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
              <p className="text-xs leading-6 text-base-content/55">{text.transcriptionContextHint}</p>
            </section>
          </div>

          {historyItems?.length ? (
            <div className="sidebar-history-dock">
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
