import { useState } from 'react';
import { Pause, Pencil, Play, Plus, RotateCcw, SkipForward, Square } from 'lucide-react';
import { describeRule, nextOccurrence, skippedFrom } from '../domain/personal';
import { relativeDay } from '../domain/format';
import type { Frequency } from '../domain/dates';
import type { PersonalData, RecurrenceInput, RecurrenceRule } from '../services/personal';
import type { Task } from '../services/workspace';
import { FormDialog, WeekdayPicker, type PersonalOps, type Run } from './shared';
import { shortDate } from './format';

const draftFor = (today: string, rule?: RecurrenceRule): RecurrenceInput => rule
  ? { id: rule.id, title: rule.title, description: rule.description, priority: rule.priority, frequency: rule.frequency, weekdays: rule.weekdays, monthDay: rule.monthDay, startDate: rule.startDate, endDate: rule.endDate, dueTime: rule.dueTime, reminderOffsetMinutes: rule.reminderOffsetMinutes }
  : { id: crypto.randomUUID(), title: '', description: '', priority: 'normal', frequency: 'weekly', weekdays: [], monthDay: null, startDate: today, endDate: null, dueTime: null, reminderOffsetMinutes: null };

/**
 * Recurring responsibilities. A rule creates ordinary tasks (the only task system); this section manages the
 * rule. Completing an occurrence is the normal task checkbox, and it never completes any other occurrence.
 */
export function RecurringSection({ personal, tasks, today, ops, run }: { personal: PersonalData; tasks: Task[]; today: string; ops: PersonalOps; run: Run }) {
  const [draft, setDraft] = useState<RecurrenceInput | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editing = draft ? personal.rules.some(r => r.id === draft.id) : false;
  const patch = (v: Partial<RecurrenceInput>) => setDraft(d => d ? { ...d, ...v } : d);
  const act = async (operation: () => Promise<void>) => setNotice(await run(operation) ?? '');
  const live = personal.rules.filter(r => r.status !== 'ended'); const ended = personal.rules.filter(r => r.status === 'ended');
  async function save() {
    if (!draft) return;
    const input: RecurrenceInput = { ...draft, weekdays: draft.frequency === 'weekly' ? draft.weekdays : [], monthDay: draft.frequency === 'monthly' ? draft.monthDay ?? 1 : null, endDate: draft.endDate || null, dueTime: draft.dueTime || null };
    const message = await run(() => ops.saveRecurrence(input, today));
    if (message) setError(message); else { setDraft(null); setError(''); }
  }
  const row = (rule: RecurrenceRule) => {
    const next = nextOccurrence(rule, personal.occurrences, tasks, today); const skipped = skippedFrom(rule, personal.occurrences, today);
    return <li key={rule.id} className="recurring-item">
      <div className="goal-row">
        <span className="goal-name"><strong>{rule.title}</strong><small>{[describeRule(rule), rule.dueTime ? 'at ' + rule.dueTime : '', rule.status === 'active' ? (next ? 'Next: ' + relativeDay(next.date) + ' (' + shortDate(next.date) + ')' : 'Next one is created when it is near') : rule.status === 'paused' ? 'Paused' : 'Ended'].filter(Boolean).join(' · ')}</small></span>
        {rule.status === 'active' && next && <button className="soft-button" aria-label={'Skip next ' + rule.title} title="Skip this occurrence (it will not count as done)" onClick={() => void act(() => ops.skipOccurrence(next.taskId))}><SkipForward size={14}/> Skip next</button>}
        {rule.status !== 'ended' && <button className="icon-button" aria-label={'Edit recurrence ' + rule.title} onClick={() => { setError(''); setDraft(draftFor(today, rule)); }}><Pencil size={15}/></button>}
        {rule.status === 'active' && <button className="icon-button" aria-label={'Pause recurrence ' + rule.title} title="Pause" onClick={() => void act(() => ops.setRecurrenceStatus(rule.id, 'paused', today))}><Pause size={15}/></button>}
        {rule.status === 'paused' && <button className="icon-button" aria-label={'Resume recurrence ' + rule.title} title="Resume" onClick={() => void act(() => ops.setRecurrenceStatus(rule.id, 'active', today))}><Play size={15}/></button>}
        {rule.status !== 'ended' && <button className="icon-button" aria-label={'End recurrence ' + rule.title} title="End recurrence" onClick={() => { if (window.confirm('End "' + rule.title + '"? Future occurrences are removed. Completed ones and your history stay.')) void act(() => ops.setRecurrenceStatus(rule.id, 'ended', today)); }}><Square size={14}/></button>}
      </div>
      {skipped.map(o => <p key={o.occurrenceDate} className="quiet-note skipped-note">Skipped {shortDate(o.occurrenceDate)} <button className="context-link" aria-label={'Restore ' + rule.title + ' on ' + shortDate(o.occurrenceDate)} onClick={() => void act(() => ops.restoreOccurrence(rule.id, o.occurrenceDate, today))}><RotateCcw size={12}/> Restore</button></p>)}
    </li>;
  };
  return <details className="more-options recurring-section">
    <summary>Recurring responsibilities ({live.length})</summary>
    <div className="study-actions"><button className="soft-button" onClick={() => { setError(''); setDraft(draftFor(today)); }}><Plus size={14}/> New recurring task</button></div>
    {notice && <p role="alert" className="form-error">{notice}</p>}
    {live.length ? <ul className="goal-list" aria-label="Recurring responsibilities">{live.map(row)}</ul> : <p className="quiet-note">Nothing repeats yet. Add rent, trash day or a weekly clean-up; each occurrence becomes an ordinary task on its date.</p>}
    {ended.length > 0 && <details className="more-options"><summary>Ended ({ended.length})</summary><ul className="goal-list" aria-label="Ended recurrences">{ended.map(row)}</ul></details>}
    {draft && <FormDialog title={editing ? 'Edit recurring task' : 'New recurring task'} submitLabel="Save recurring task" error={error} onClose={() => { setDraft(null); setError(''); }} onSubmit={() => void save()}>
      <label>Title<input autoFocus required maxLength={200} value={draft.title} onChange={e => patch({ title: e.target.value })}/></label>
      <div className="form-grid">
        <label>Repeats<select value={draft.frequency} onChange={e => patch({ frequency: e.target.value as Frequency, monthDay: e.target.value === 'monthly' ? draft.monthDay ?? 1 : null })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
        {draft.frequency === 'monthly' && <label>Day of the month<input type="number" min={1} max={31} required value={draft.monthDay ?? 1} onChange={e => patch({ monthDay: Number(e.target.value) })}/></label>}
        <label>Starts<input type="date" required value={draft.startDate} onChange={e => patch({ startDate: e.target.value })}/></label>
        <label>Ends (optional)<input type="date" min={draft.startDate} value={draft.endDate ?? ''} onChange={e => patch({ endDate: e.target.value || null })}/></label>
        <label>Due time (optional)<input type="time" value={draft.dueTime ?? ''} onChange={e => patch({ dueTime: e.target.value || null })}/></label>
        <label>Priority<select value={draft.priority} onChange={e => patch({ priority: e.target.value as RecurrenceInput['priority'] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
      </div>
      {draft.frequency === 'weekly' && <WeekdayPicker legend="On these days" value={draft.weekdays} onChange={weekdays => patch({ weekdays })}/>}
      {draft.frequency === 'monthly' && (draft.monthDay ?? 1) > 28 && <p className="time-zone-note">In months with fewer days this falls on the last day of the month (for example the 31st becomes Feb 28 or 29, or Apr 30).</p>}
      <p className="time-zone-note">Only the next few occurrences exist as tasks at any time. Changing the schedule re-plans the future ones; completed and past ones are kept.</p>
      <details className="more-options" open={Boolean(draft.description)}><summary>Notes</summary><label>Description<textarea rows={3} maxLength={10000} value={draft.description} onChange={e => patch({ description: e.target.value })}/></label></details>
    </FormDialog>}
  </details>;
}
