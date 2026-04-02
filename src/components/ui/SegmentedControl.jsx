export function SegmentedControl({ name, value, options, onChange, tone = 'light' }) {
  const containerClass =
    tone === 'dark'
      ? 'grid gap-3'
      : 'grid gap-3';

  return (
    <div className={containerClass} role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const active = option.value === value;
        const cardClass =
          tone === 'dark'
            ? active
              ? 'rounded-[18px] border border-white/24 bg-white/12 p-3.5 shadow-sm transition'
              : 'rounded-[18px] border border-white/10 bg-white/5 p-3.5 transition hover:border-white/18 hover:bg-white/8'
            : active
              ? 'rounded-[18px] border border-base-300 bg-base-100 p-3.5 shadow-sm transition'
              : 'rounded-[18px] border border-base-300/80 bg-base-100/45 p-3.5 transition hover:border-base-300 hover:bg-base-100/70';

        const titleClass = tone === 'dark' ? 'text-sm font-semibold text-neutral-content' : 'text-sm font-semibold';
        const descriptionClass = tone === 'dark' ? 'mt-1 text-xs leading-6 text-neutral-content/62' : 'mt-1 text-xs leading-6 text-base-content/62';

        return (
          <label key={option.value} className={`${cardClass} cursor-pointer`}>
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
            />
            <span className="block">
              <span className={`block ${titleClass}`}>{option.title}</span>
              {option.description ? (
                <span className={`block ${descriptionClass}`}>{option.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
