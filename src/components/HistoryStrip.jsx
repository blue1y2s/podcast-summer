import { formatDurationLabel, formatHistoryTimestamp, getDisplayResultTitle } from '../lib/utils';

export function HistoryStrip({
  text,
  items,
  activeHistoryId,
  onSelect,
  onDelete,
  disabled = false,
  locale = 'en-US',
  layout = 'rail',
  tone = 'light'
}) {
  if (!items?.length) {
    return null;
  }

  const isStack = layout === 'stack';
  const isDark = tone === 'dark';

  return (
    <section className={isStack ? 'history-block history-block-stack' : 'space-y-3'}>
      <div className="history-heading">
        <p className={isDark ? 'eyebrow-inverse' : 'eyebrow'}>{text.historyLabel}</p>
        {isStack ? (
          <span className={`history-count-badge ${isDark ? 'history-count-badge-dark' : ''}`}>{items.length}</span>
        ) : null}
      </div>
      <div className={isStack ? 'history-stack history-stack-contained' : 'history-strip'}>
        {items.map((item) => {
          const isActive = item.id === activeHistoryId;
          const durationLabel = formatDurationLabel(item.durationSeconds);
          const title = getDisplayResultTitle(item.podcastTitle, text.resultTitle);
          const sourceLabel = item.sourceMode === 'file' ? text.sourceLocalShort : text.sourceRemoteShort;

          return (
            <div key={item.id} className={isStack ? 'history-card-wrap group w-full' : 'history-card-wrap'}>
              <button
                type="button"
                className={[
                  'history-card',
                  isStack ? 'history-card-compact' : '',
                  isDark ? 'history-card-dark' : '',
                  isActive ? 'history-card-active' : '',
                  isActive && isDark ? 'history-card-active-dark' : '',
                  isActive && isStack ? 'history-card-active-stack' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(item.id)}
                disabled={disabled}
                aria-pressed={isActive}
                aria-label={`${text.historyOpen}: ${title}`}
              >
                <span className="history-card-accent" aria-hidden="true" />
                <div className="flex items-start justify-between gap-3">
                  <p
                    className={[
                      isDark ? 'text-sm font-medium leading-6 text-neutral-content' : 'text-sm font-medium leading-6 text-base-content',
                      isActive && isDark ? 'history-title-active-dark' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: isStack ? 1 : 2,
                      overflow: 'hidden'
                    }}
                  >
                    {title}
                  </p>
                  {isActive && !isStack ? (
                    <span
                      className={[
                        'history-current-badge',
                        isDark ? 'history-current-badge-dark' : '',
                        'history-current-chip'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {text.historyCurrent}
                    </span>
                  ) : null}
                </div>
                <div className={`mt-3 flex flex-wrap gap-2 ${isStack ? 'mt-2' : ''}`}>
                  <span className={`meta-chip ${isDark ? 'meta-chip-dark' : ''} ${isActive && isDark ? 'meta-chip-dark-active' : ''}`}>
                    {formatHistoryTimestamp(item.updatedAt, locale)}
                  </span>
                  <span className={`meta-chip ${isDark ? 'meta-chip-dark' : ''} ${isActive && isDark ? 'meta-chip-dark-active' : ''}`}>
                    {sourceLabel}
                  </span>
                  {durationLabel ? (
                    <span className={`meta-chip ${isDark ? 'meta-chip-dark' : ''} ${isActive && isDark ? 'meta-chip-dark-active' : ''}`}>
                      {durationLabel}
                    </span>
                  ) : null}
                  {!isStack && item.hasSummary ? (
                    <span className={`meta-chip ${isDark ? 'meta-chip-dark' : ''} ${isActive && isDark ? 'meta-chip-dark-active' : ''}`}>
                      {text.summaryTab}
                    </span>
                  ) : null}
                  {!isStack && item.hasTranslation ? (
                    <span className={`meta-chip ${isDark ? 'meta-chip-dark' : ''} ${isActive && isDark ? 'meta-chip-dark-active' : ''}`}>
                      {text.translationTab}
                    </span>
                  ) : null}
                </div>
              </button>
              {onDelete ? (
                <button
                  type="button"
                  className={[
                    'history-card-delete',
                    isDark ? 'history-card-delete-dark' : '',
                    isActive ? 'history-card-delete-active' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item.id);
                  }}
                  disabled={disabled}
                  aria-label={`${text.historyDelete}: ${title}`}
                  title={text.historyDelete}
                >
                  {text.historyDelete}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
