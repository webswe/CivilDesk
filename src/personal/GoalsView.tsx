import { useState } from 'react';
import { Pencil, Plus, Undo2 } from 'lucide-react';
import { goalSummary, liveEntries, periodHistory, periodNoun, quantity, type GoalSummary } from '../domain/personal';
import type { Goal, GoalEntry, GoalInput, GoalKind, PersonalData } from '../services/personal';
import type { Period } from '../domain/dates';
import { FormDialog, type PersonalOps, type Run } from './shared';
import { plural, shortDate } from './format';

const kindLabel: Record<GoalKind, string> = { binary: 'Yes / no', numeric: 'Measured total', periodic: 'Repeating target' };
const periodLabel: Record<Period, string> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
const draftFor = (today: string, goal?: Goal): GoalInput => goal
  ? { id: goal.id, title: goal.title, description: goal.description, kind: goal.kind, target: goal.target, unit: goal.unit, period: goal.period, startDate: goal.startDate, targetDate: goal.targetDate }
  : { id: crypto.randomUUID(), title: '', description: '', kind: 'numeric', target: null, unit: '', period: null, startDate: today, targetDate: null };

function summaryText(goal: Goal, s: GoalSummary): string {
  if (goal.kind === 'binary') return goal.status === 'completed' ? 'Completed' : 'Not done yet';
  const unit = goal.unit;
  if (goal.kind === 'periodic' && goal.period) return `${quantity(s.total, unit)} of ${s.target !== null ? quantity(s.target, unit) : '—'} ${periodNoun[goal.period]}${s.reached ? ' · target met' : ''}`;
  return `${quantity(s.total, unit)} of ${goal.target !== null ? quantity(goal.target, unit) : '—'}${s.reached ? ' · target reached' : ''}`;
}

export function GoalsView({ data, today, ops, run }: { data: PersonalData; today: string; ops: PersonalOps; run: Run }) {
  const [draft, setDraft] = useState<GoalInput | null>(null);
  const [logging, setLogging] = useState<{ goal: Goal; id: string; amount: string; date: string; note: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editing = draft ? data.goals.some(g => g.id === draft.id) : false;
  const active = data.goals.filter(g => g.status === 'active'); const others = data.goals.filter(g => g.status !== 'active');
  const patch = (v: Partial<GoalInput>) => setDraft(d => d ? { ...d, ...v } : d);
  const act = async (operation: () => Promise<void>) => { setNotice(await run(operation) ?? ''); };

  async function saveDraft() {
    if (!draft) return;
    const input: GoalInput = { ...draft, target: draft.kind === 'binary' ? null : draft.target, period: draft.kind === 'periodic' ? draft.period ?? 'weekly' : null, targetDate: draft.targetDate || null };
    const message = await run(() => ops.saveGoal(input, today));
    if (message) setError(message); else { setDraft(null); setError(''); }
  }
  async function saveProgress() {
    if (!logging) return;
    const message = await run(() => ops.addGoalEntry({ id: logging.id, goalId: logging.goal.id, entryDate: logging.date, amount: Number(logging.amount), note: logging.note }, today));
    if (message) setError(message); else { setLogging(null); setError(''); }
  }
  const goalRow = (goal: Goal) => {
    const s = goalSummary(goal, data.goalTargets, data.goalEntries, today); const isOpen = open === goal.id;
    const entries = data.goalEntries.filter(e => e.goalId === goal.id).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdAtMs - a.createdAtMs);
    const history = periodHistory(goal, data.goalTargets, data.goalEntries, today);
    return <li key={goal.id} className="goal-item">
      <div className="goal-row">
        <span className="goal-name"><button className="context-link goal-title" aria-expanded={isOpen} aria-label={(isOpen ? 'Hide details for ' : 'Show details for ') + goal.title} onClick={() => setOpen(isOpen ? null : goal.id)}>{goal.title}</button>
          <small>{[kindLabel[goal.kind] + (goal.period ? ' · ' + periodLabel[goal.period].toLowerCase() : ''), summaryText(goal, s), goal.targetDate ? 'Aim: ' + shortDate(goal.targetDate) : '', goal.status !== 'active' ? goal.status[0]!.toUpperCase() + goal.status.slice(1) : ''].filter(Boolean).join(' · ')}</small></span>
        {goal.kind !== 'binary' && s.fraction !== null && <progress max={1} value={s.fraction} aria-label={'Progress for ' + goal.title}/>}
        {goal.status === 'active' && goal.kind !== 'binary' && <button className="soft-button" aria-label={'Log progress for ' + goal.title} onClick={() => { setError(''); setLogging({ goal, id: crypto.randomUUID(), amount: '', date: today, note: '' }); }}><Plus size={14}/> Log progress</button>}
        {goal.status === 'active' && goal.kind !== 'periodic' && <button className="soft-button" aria-label={'Mark ' + goal.title + ' complete'} onClick={() => void act(() => ops.setGoalStatus(goal.id, 'completed'))}>{goal.kind === 'numeric' && s.reached ? 'Mark complete' : 'Complete'}</button>}
        {goal.status === 'completed' && <button className="soft-button" aria-label={'Reopen ' + goal.title} onClick={() => void act(() => ops.setGoalStatus(goal.id, 'active'))}><Undo2 size={14}/> Reopen</button>}
        <button className="icon-button" aria-label={'Edit ' + goal.title} onClick={() => { setError(''); setDraft(draftFor(today, goal)); }}><Pencil size={15}/></button>
      </div>
      {isOpen && <div className="goal-detail" aria-label={'Details for ' + goal.title}>
        {goal.description && <p className="quiet-note">{goal.description}</p>}
        <div className="button-row">
          {goal.status === 'active' && <button className="soft-button" onClick={() => void act(() => ops.setGoalStatus(goal.id, 'paused'))}>Pause</button>}
          {goal.status === 'paused' && <button className="soft-button" onClick={() => void act(() => ops.setGoalStatus(goal.id, 'active'))}>Resume</button>}
          {goal.status !== 'archived' && <button className="soft-button" onClick={() => void act(() => ops.setGoalStatus(goal.id, 'archived'))}>Archive</button>}
          {goal.status === 'archived' && <button className="soft-button" onClick={() => void act(() => ops.setGoalStatus(goal.id, 'active'))}>Restore</button>}
        </div>
        {goal.kind !== 'binary' && <>
          <h3>Progress history</h3>
          {entries.length ? <ul className="course-list" aria-label={'Progress entries for ' + goal.title}>{entries.slice(0, 20).map((e: GoalEntry) => <li key={e.id} className="course-row"><span className="course-row-text"><strong className={e.voidedAtMs ? 'voided' : ''}>{'+' + quantity(e.amount, goal.unit)}</strong><small>{shortDate(e.entryDate)}{e.note ? ' · ' + e.note : ''}{e.voidedAtMs ? ' · Removed (kept in history)' : ''}</small></span>
            {!e.voidedAtMs && <button className="soft-button" aria-label={'Remove ' + quantity(e.amount, goal.unit) + ' entry from ' + shortDate(e.entryDate)} onClick={() => void act(() => ops.voidGoalEntry(e.id))}>Remove</button>}</li>)}</ul>
            : <p className="quiet-note">No progress recorded yet. Use Log progress when you make some.</p>}
          {entries.length > 0 && <p className="time-zone-note">Entries are never edited. To correct a mistake, remove the entry and log the right amount; {plural(liveEntries(data.goalEntries, goal.id).length, 'entry', 'entries')} currently count.</p>}
          {history.length > 0 && <><h3>Earlier {goal.period === 'daily' ? 'days' : goal.period === 'monthly' ? 'months' : 'weeks'}</h3><ul className="course-list" aria-label={'Earlier periods for ' + goal.title}>{history.map(h => <li key={h.start} className="course-row"><span className="course-row-text"><strong>{quantity(h.total, goal.unit)} of {h.target !== null ? quantity(h.target, goal.unit) : '—'}</strong><small>{shortDate(h.start)}{h.end !== h.start ? ' – ' + shortDate(h.end) : ''}{h.met ? ' · target met' : ''}</small></span></li>)}</ul></>}
        </>}
      </div>}
    </li>;
  };
  return <div className="personal-view">
    <div className="study-actions"><button className="primary-button" onClick={() => { setError(''); setDraft(draftFor(today)); }}><Plus size={14}/> New goal</button></div>
    {notice && <p role="alert" className="form-error">{notice}</p>}
    {data.goals.length === 0 ? <div className="empty-state"><h2>No goals yet</h2><p>A goal is an outcome you measure: finish something, reach a total, or repeat a target every week or month.</p></div>
      : <section className="school-section" aria-labelledby="goals-active-heading"><h2 id="goals-active-heading">Active goals</h2>
        {active.length ? <ul className="goal-list" aria-label="Active goals">{active.map(goalRow)}</ul> : <p className="quiet-note">No active goals right now.</p>}
        {others.length > 0 && <details className="more-options school-more"><summary>Paused, completed and archived ({others.length})</summary><ul className="goal-list" aria-label="Other goals">{others.map(goalRow)}</ul></details>}
      </section>}
    {draft && <FormDialog title={editing ? 'Edit goal' : 'New goal'} submitLabel="Save goal" error={error} onClose={() => { setDraft(null); setError(''); }} onSubmit={() => void saveDraft()}>
      <label>Title<input autoFocus required maxLength={200} value={draft.title} onChange={e => patch({ title: e.target.value })}/></label>
      <div className="form-grid">
        <label>Type<select value={draft.kind} disabled={editing} onChange={e => patch({ kind: e.target.value as GoalKind, period: e.target.value === 'periodic' ? draft.period ?? 'weekly' : null })}><option value="numeric">Measured total (e.g. read 300 pages)</option><option value="periodic">Repeating target (e.g. 100 pages a week)</option><option value="binary">Yes / no (finish something)</option></select></label>
        {draft.kind === 'periodic' && <label>Repeats<select value={draft.period ?? 'weekly'} disabled={editing} onChange={e => patch({ period: e.target.value as Period })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>}
        {draft.kind !== 'binary' && <label>Target<input type="number" min={1} max={1000000000} step={1} required value={draft.target ?? ''} onChange={e => patch({ target: e.target.value === '' ? null : Number(e.target.value) })}/></label>}
        {draft.kind !== 'binary' && <label>Unit<input maxLength={40} placeholder="pages, workouts, $…" value={draft.unit} onChange={e => patch({ unit: e.target.value })}/></label>}
        <label>Starts<input type="date" required disabled={editing} value={draft.startDate} onChange={e => patch({ startDate: e.target.value })}/></label>
        <label>Aim to finish by<input type="date" value={draft.targetDate ?? ''} min={draft.startDate} onChange={e => patch({ targetDate: e.target.value || null })}/></label>
      </div>
      {editing && draft.kind === 'periodic' && <p className="time-zone-note">A new target applies from the start of the current {draft.period === 'daily' ? 'day' : draft.period === 'monthly' ? 'month' : 'week'}. Earlier periods keep the target they had.</p>}
      {draft.kind !== 'binary' && <p className="time-zone-note">Targets and progress are whole numbers.</p>}
      <details className="more-options" open={Boolean(draft.description)}><summary>Notes</summary><label>Description<textarea rows={3} maxLength={5000} value={draft.description} onChange={e => patch({ description: e.target.value })}/></label></details>
    </FormDialog>}
    {logging && <FormDialog title={'Log progress · ' + logging.goal.title} submitLabel="Save progress" error={error} onClose={() => { setLogging(null); setError(''); }} onSubmit={() => void saveProgress()}>
      <div className="form-grid">
        <label>Amount{logging.goal.unit ? ' (' + logging.goal.unit + ')' : ''}<input autoFocus type="number" required min={1} step={1} value={logging.amount} onChange={e => setLogging({ ...logging, amount: e.target.value })}/></label>
        <label>Date<input type="date" required max={today} min={logging.goal.startDate} value={logging.date} onChange={e => setLogging({ ...logging, date: e.target.value })}/></label>
      </div>
      <label>Note<input maxLength={500} value={logging.note} onChange={e => setLogging({ ...logging, note: e.target.value })}/></label>
    </FormDialog>}
  </div>;
}
