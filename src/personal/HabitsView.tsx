import { useState } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import { habitLine, habitStats, type HabitStats } from '../domain/personal';
import { weekdayLong } from '../domain/dates';
import type { Habit, HabitInput, PersonalData } from '../services/personal';
import { FormDialog, WeekdayPicker, type PersonalOps, type Run } from './shared';
import { plural, shortDate } from './format';

const draftFor = (habit?: Habit, stats?: HabitStats): HabitInput => habit
  ? { id: habit.id, name: habit.name, description: habit.description, frequency: stats?.schedule?.frequency ?? 'daily', targetCount: stats?.schedule?.targetCount ?? 1, preferredDays: stats?.schedule?.preferredDays ?? [], startDate: null }
  : { id: crypto.randomUUID(), name: '', description: '', frequency: 'daily', targetCount: 1, preferredDays: [], startDate: null };

export function HabitsView({ data, today, ops, run, onCheckin }: { data: PersonalData; today: string; ops: PersonalOps; run: Run; onCheckin: () => void }) {
  const [draft, setDraft] = useState<HabitInput | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editing = draft ? data.habits.some(h => h.id === draft.id) : false;
  const patch = (v: Partial<HabitInput>) => setDraft(d => d ? { ...d, ...v } : d);
  const active = data.habits.filter(h => h.status === 'active'); const others = data.habits.filter(h => h.status !== 'active');
  async function toggle(habit: Habit, date: string, done: boolean) {
    const message = await run(() => ops.setHabitCheckin(habit.id, date, done, today));
    setNotice(message ?? ''); if (!message && done && date === today) onCheckin();
  }
  async function save() {
    if (!draft) return;
    const input: HabitInput = { ...draft, targetCount: draft.frequency === 'daily' ? 1 : draft.targetCount, preferredDays: draft.frequency === 'weekly' ? draft.preferredDays : [] };
    const message = await run(() => ops.saveHabit(input, today));
    if (message) setError(message); else { setDraft(null); setError(''); }
  }
  const row = (habit: Habit) => {
    const stats = habitStats(habit, data.habitSchedules, data.habitCheckins, today); const isOpen = open === habit.id; const live = habit.status === 'active';
    return <li key={habit.id} className="habit-item">
      <div className="goal-row">
        <button className={'task-check' + (stats.doneToday ? ' checked' : '')} role="checkbox" aria-checked={stats.doneToday} disabled={!live} aria-label={(stats.doneToday ? 'Undo today\'s check-in for ' : 'Check in ') + habit.name}
          onClick={() => void toggle(habit, today, !stats.doneToday)}>{stats.doneToday && <Check size={15}/>}</button>
        <span className="goal-name"><button className="context-link goal-title" aria-expanded={isOpen} aria-label={(isOpen ? 'Hide details for ' : 'Show details for ') + habit.name} onClick={() => setOpen(isOpen ? null : habit.id)}>{habit.name}</button>
          <small>{habitLine(stats)}{live ? '' : ' · ' + habit.status[0]!.toUpperCase() + habit.status.slice(1)}</small></span>
        <button className="icon-button" aria-label={'Edit ' + habit.name} onClick={() => { setError(''); setDraft(draftFor(habit, stats)); }}><Pencil size={15}/></button>
      </div>
      {isOpen && <div className="goal-detail" aria-label={'Details for ' + habit.name}>
        {habit.description && <p className="quiet-note">{habit.description}</p>}
        <p className="quiet-note">{plural(stats.completed, 'check-in')} in total · best streak {plural(stats.bestStreak, stats.unit)}{stats.adherence ? ` · ${stats.adherence.met} of ${stats.adherence.of} ${stats.adherence.unit} met recently` : ''}</p>
        <div className="habit-days" role="group" aria-label={'Last 14 days for ' + habit.name}>{stats.recent.map(d => <button key={d.date} className={'habit-day' + (d.done ? ' done' : '')} disabled={!live || d.beforeStart} role="checkbox" aria-checked={d.done} title={shortDate(d.date)} aria-label={(d.done ? 'Undo ' : 'Mark ') + habit.name + (d.done ? ' on ' : ' done on ') + shortDate(d.date)} onClick={() => void toggle(habit, d.date, !d.done)}><span aria-hidden="true">{new Date(d.date + 'T12:00:00').getDate()}</span></button>)}</div>
        <div className="button-row">
          {habit.status === 'active' && <button className="soft-button" onClick={() => void run(() => ops.setHabitStatus(habit.id, 'paused'))}>Pause</button>}
          {habit.status === 'paused' && <button className="soft-button" onClick={() => void run(() => ops.setHabitStatus(habit.id, 'active'))}>Resume</button>}
          {habit.status !== 'archived' && <button className="soft-button" onClick={() => void run(() => ops.setHabitStatus(habit.id, 'archived'))}>Archive</button>}
          {habit.status === 'archived' && <button className="soft-button" onClick={() => void run(() => ops.setHabitStatus(habit.id, 'active'))}>Restore</button>}
        </div>
        <p className="time-zone-note">Pausing does not freeze a streak, and archiving keeps all history.</p>
      </div>}
    </li>;
  };
  return <div className="personal-view">
    <div className="study-actions"><button className="primary-button" onClick={() => { setError(''); setDraft(draftFor()); }}><Plus size={14}/> New habit</button></div>
    {notice && <p role="alert" className="form-error">{notice}</p>}
    {data.habits.length === 0 ? <div className="empty-state"><h2>No habits yet</h2><p>A habit is something you repeat: every day, or a few days each week. Check it in when you do it; missed days never count as done.</p></div>
      : <section className="school-section" aria-labelledby="habits-heading"><h2 id="habits-heading">Habits</h2>
        {active.length ? <ul className="goal-list" aria-label="Habits">{active.map(row)}</ul> : <p className="quiet-note">No active habits right now.</p>}
        {others.length > 0 && <details className="more-options school-more"><summary>Paused and archived ({others.length})</summary><ul className="goal-list" aria-label="Paused and archived habits">{others.map(row)}</ul></details>}
      </section>}
    {draft && <FormDialog title={editing ? 'Edit habit' : 'New habit'} submitLabel="Save habit" error={error} onClose={() => { setDraft(null); setError(''); }} onSubmit={() => void save()}>
      <label>Name<input autoFocus required maxLength={120} value={draft.name} onChange={e => patch({ name: e.target.value })}/></label>
      <div className="form-grid">
        <label>How often<select value={draft.frequency} onChange={e => patch({ frequency: e.target.value as 'daily' | 'weekly', targetCount: e.target.value === 'daily' ? 1 : Math.max(2, draft.targetCount) })}><option value="daily">Every day</option><option value="weekly">A few days each week</option></select></label>
        {draft.frequency === 'weekly' && <label>Days per week<input type="number" min={1} max={7} required value={draft.targetCount} onChange={e => patch({ targetCount: Number(e.target.value) })}/></label>}
        {!editing && <label>Started on<input type="date" required max={today} value={draft.startDate ?? today} onChange={e => patch({ startDate: e.target.value })}/></label>}
      </div>
      {draft.frequency === 'weekly' && <WeekdayPicker legend="Preferred days (optional)" value={draft.preferredDays} onChange={preferredDays => patch({ preferredDays })}/>}
      {editing && <p className="time-zone-note">A new schedule applies from the start of this week. Earlier weeks keep the schedule they had.</p>}
      {draft.frequency === 'weekly' && draft.preferredDays.length > 0 && <p className="time-zone-note">Preferred days are a reminder only; any {draft.targetCount} days in the week count ({draft.preferredDays.map(d => weekdayLong[d]).join(', ')}).</p>}
      <details className="more-options" open={Boolean(draft.description)}><summary>Notes</summary><label>Description<textarea rows={3} maxLength={2000} value={draft.description} onChange={e => patch({ description: e.target.value })}/></label></details>
    </FormDialog>}
  </div>;
}
