const tabs = [{ id: 'Pip', label: 'Companion' }, { id: 'Customization', label: 'Wardrobe' }, { id: 'Achievements', label: 'Achievements' }];
export function PipTabs({ current, goTo }: { current: string; goTo: (page: string) => void }) {
  return <div className="segmented" role="group" aria-label="Pip sections">{tabs.map(t => <button key={t.id} className={current === t.id ? 'active' : ''} aria-pressed={current === t.id} onClick={() => goTo(t.id)}>{t.label}</button>)}</div>;
}
