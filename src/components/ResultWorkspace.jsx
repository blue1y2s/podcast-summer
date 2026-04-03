import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { Tabs } from './ui/Tabs';
import { asrBackendOptions } from '../lib/translations';
import { escapeHtml, formatDateTimeLabel, getDisplayResultTitle } from '../lib/utils';

marked.setOptions({
  breaks: true,
  gfm: true
});

function renderMarkdown(content) {
  if (!content) {
    return '';
  }

  return marked.parse(escapeHtml(content));
}

export function ResultWorkspace({
  text,
  status,
  errorMessage,
  progress,
  result,
  activeTab,
  onTabChange,
  onCopy
}) {
  const headline = getDisplayResultTitle(result?.podcastTitle, text.resultTitle);
  const tabs = [
    result?.transcript ? { id: 'transcript', label: text.transcriptTab, content: result.transcript } : null,
    result?.summary ? { id: 'summary', label: text.summaryTab, content: result.summary } : null,
    result?.needsTranslation && result?.translation
      ? { id: 'translation', label: text.translationTab, content: result.translation }
      : null
  ].filter(Boolean);

  const currentTab = tabs.find((tab) => tab.id === activeTab) || tabs[0] || null;
  const showTabs = tabs.length > 1;
  const structuredSegments = result?.structuredTranscript?.segments || [];
  const hasStructuredSegments = activeTab === 'transcript' && structuredSegments.length > 0;
  const showContent = Boolean(result && currentTab && ['success', 'loading', 'error'].includes(status));
  const locale = text.langKey === 'zh' ? 'zh-CN' : 'en-US';
  const [activeSegmentId, setActiveSegmentId] = useState(structuredSegments[0]?.id || null);
  const transcriptBodyRef = useRef(null);
  const segmentRefs = useRef(new Map());
  const timelineSegments = useMemo(
    () =>
      structuredSegments.map((segment) => ({
        ...segment,
        preview: String(segment.text || '').replace(/\s+/g, ' ').trim()
      })),
    [structuredSegments]
  );

  useEffect(() => {
    setActiveSegmentId(structuredSegments[0]?.id || null);
  }, [result?.historyId, activeTab, structuredSegments]);

  useEffect(() => {
    if (!hasStructuredSegments || !transcriptBodyRef.current) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visibleEntries.length > 0) {
          setActiveSegmentId(visibleEntries[0].target.getAttribute('data-segment-id'));
        }
      },
      {
        root: transcriptBodyRef.current,
        threshold: [0.2, 0.45, 0.7],
        rootMargin: '0px 0px -55% 0px'
      }
    );

    const elements = timelineSegments
      .map((segment) => segmentRefs.current.get(segment.id))
      .filter(Boolean);

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [hasStructuredSegments, timelineSegments]);

  function handleTimelineSelect(segmentId) {
    setActiveSegmentId(segmentId);
    const target = segmentRefs.current.get(segmentId);
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  const timeItems = result
    ? [
        {
          key: 'processedAt',
          label: text.processedAt,
          value: formatDateTimeLabel(result.updatedAt, locale)
        },
        {
          key: 'publishedAt',
          label: text.publishedAt,
          value: formatDateTimeLabel(result.publishedAt, locale)
        }
      ].filter((item) => item.value)
    : [];
  const backendLabelByValue = useMemo(
    () =>
      Object.fromEntries(
        asrBackendOptions.map((option) => [option.value, option[text.langKey]])
      ),
    [text.langKey]
  );
  const backendItems = result
    ? [
        result.asrBackendUsed
          ? {
              key: 'asrBackendUsed',
              label: text.asrBackendUsed,
              value: backendLabelByValue[result.asrBackendUsed] || result.asrBackendUsed
            }
          : null,
        result.asrBackendRequested && result.asrBackendRequested !== result.asrBackendUsed
          ? {
              key: 'asrBackendRequested',
              label: text.asrBackendRequested,
              value: backendLabelByValue[result.asrBackendRequested] || result.asrBackendRequested
            }
          : null
      ].filter(Boolean)
    : [];
  const resultHeader = (
    <div className="result-pane-header">
      <div className="space-y-3">
        <h1 className="result-pane-title">{headline}</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {timeItems.map((item) => (
              <span key={item.key} className="meta-chip">
                {item.label}: {item.value}
              </span>
            ))}
            {backendItems.map((item) => (
              <span key={item.key} className="meta-chip">
                {item.label}: {item.value}
              </span>
            ))}
          </div>
          <div className="shrink-0 sm:self-end">
            <button type="button" className="workspace-action-button workspace-action-button-quiet" onClick={onCopy}>
              <span className="workspace-action-label">{text.copyCurrent}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <section className="workspace-section">
      {status === 'loading' ? (
        <div className="workspace-progress">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{text.progressTitle}</p>
                <p className="mt-1 text-sm text-base-content/62">{progress.label || text.loadingHint}</p>
              </div>
              <span className="font-mono text-sm">{progress.value}%</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {progress.elapsedLabel ? <span className="meta-chip">{`${text.progressElapsed}: ${progress.elapsedLabel}`}</span> : null}
            </div>
            <div className="progress-rail">
              <div className="progress-bar" style={{ width: `${progress.value}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="markdown-canvas flex min-h-0 flex-1 flex-col justify-center">
          <div className="max-w-xl space-y-3">
            <p className="text-xl font-semibold tracking-[-0.02em]">{text.errorTitle}</p>
            <p className="text-sm leading-7 text-base-content/70">{errorMessage}</p>
          </div>
        </div>
      ) : null}

      {status === 'idle' && !showContent ? <div className="markdown-canvas min-h-0 flex-1" /> : null}

      {showContent ? (
        <div className="workspace-content">
          {showTabs ? <Tabs tabs={tabs} activeTab={currentTab.id} onChange={onTabChange} /> : null}
          {hasStructuredSegments ? (
            <div className="result-split-grid">
              <aside className="markdown-canvas result-rail p-0">
                <div className="border-b border-base-300 px-4 py-4">
                  <p className="eyebrow">{text.segmentRailTitle}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="meta-chip">
                      {text.segmentCount}: {timelineSegments.length}
                    </span>
                    {result.structuredTranscript?.timingMode === 'estimated' ? (
                      <span className="meta-chip">{text.estimatedTiming}</span>
                    ) : null}
                  </div>
                </div>
                <div className="timeline-list">
                  {timelineSegments.map((segment) => (
                    <button
                      key={segment.id}
                      type="button"
                      className={`timeline-item ${activeSegmentId === segment.id ? 'timeline-item-active' : ''}`}
                      onClick={() => handleTimelineSelect(segment.id)}
                    >
                      <span className="timeline-item-line" aria-hidden="true" />
                      <div className="flex items-start justify-between gap-3">
                        <span className="timeline-speaker">{segment.speaker || text.speakerUnknown}</span>
                        {segment.timeLabel ? <span className="timeline-time">{segment.timeLabel}</span> : null}
                      </div>
                      {segment.preview ? <p className="timeline-preview">{segment.preview}</p> : null}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="markdown-canvas result-canvas p-0">
                {resultHeader}
                <div ref={transcriptBodyRef} className="result-canvas-body">
                  <article className="transcript-document">
                    {timelineSegments.map((segment) => (
                      <section
                        key={segment.id}
                        ref={(node) => {
                          if (node) {
                            segmentRefs.current.set(segment.id, node);
                          } else {
                            segmentRefs.current.delete(segment.id);
                          }
                        }}
                        data-segment-id={segment.id}
                        className={`transcript-section ${activeSegmentId === segment.id ? 'transcript-section-active' : ''}`}
                      >
                        <header className="transcript-section-header">
                          <h2 className="transcript-speaker">{segment.speaker || text.speakerUnknown}</h2>
                          {segment.timeLabel ? <span className="transcript-time">{segment.timeLabel}</span> : null}
                        </header>
                        <p className="transcript-text">{segment.text}</p>
                      </section>
                    ))}
                  </article>
                </div>
              </div>
            </div>
          ) : (
            <div className="markdown-canvas result-canvas p-0">
              {resultHeader}
              <article
                className="workspace-prose result-canvas-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(currentTab.content) }}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
