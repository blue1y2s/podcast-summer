export function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div className="tabs-row" role="tablist" aria-label="Result views">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`tab-trigger ${active ? 'tab-trigger-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
