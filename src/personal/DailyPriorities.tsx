import { useState } from 'react';
import { ArrowDown, ArrowUp, Play, X } from 'lucide-react';
import { carryOver, prioritiesFor } from '../domain/personal';
import { formatDue } from '../domain/format';
import { MAX_PRIORITIES, type PersonalData } from '../services/personal';
import type { Task } from '../services/workspace';
import type { PersonalOps, Run } from './shared';

/**
 * Today's priorities: a short, ordered plan. It is only a view over existing tasks: choosing, reordering or
 * removing a priority never edits the task, its due date or its completion.
 */
export function DailyPriorities({ tasks, personal, today, ops, run, complete, startFocus, label = 'Today\'s priorities' }: {
  tasks: Task[]; personal: PersonalData; today: string; ops: PersonalOps; run: Run; complete: (id: string, value: boolean) => Promise<void>; startFocus: (taskId: string) => void; label?: string;
}) {
  const [message, setMessage] = useState('');
  const list = prioritiesFor(today, personal.priorities, tasks);
  const ids = list.map(t => t.id);
  const carry = carryOver(today, personal.priorities, tasks);
  const rank = (t: Task) => (t.dueDate ? (t.dueDate < today ? 0 : t.dueDate === today ? 1 : 2) : 3);
  const choices = tasks.filter(t => !t.completedAtMs && !ids.includes(t.id)).sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title)).slice(0, 60);
  const full = list.length >= MAX_PRIORITIES;
  const save = async (next: string[]) => setMessage(await run(() => ops.setDailyPriorities(today, next, today)) ?? '');
  const move = (i: number, by: number) => { const next = [...ids]; const [id] = next.splice(i, 1); next.splice(i + by, 0, id!); void save(next); };
  return <section className="priorities" aria-labelledby="priorities-heading">
    <h2 id="priorities-heading">{label}</h2>
    {list.length ? <ul className="day-list" aria-label="Priorities for today">{list.map((t, i) => { const due = t.dueDate ? formatDue(t.dueDate, t.dueTime) : null;
      return <li key={t.id} className="day-row">
        <button className="task-check" aria-label={(t.completedAtMs ? 'Reopen ' : 'Complete ') + t.title} onClick={() => void complete(t.id, !t.completedAtMs)}>{t.completedAtMs ? '✓' : null}</button>
        <span className={'day-row-text' + (t.completedAtMs ? ' task-done' : '')}><strong>{t.title}</strong><small>{due ? due.text : 'No due date'}{t.priority === 'high' ? ' · High priority' : ''}</small></span>
        {!t.completedAtMs && <button className="soft-button" aria-label={'Start focus on ' + t.title} onClick={() => startFocus(t.id)}><Play size={13}/> Focus</button>}
        <button className="icon-button" aria-label={'Move ' + t.title + ' up'} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15}/></button>
        <button className="icon-button" aria-label={'Move ' + t.title + ' down'} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15}/></button>
        <button className="icon-button" aria-label={'Remove ' + t.title + ' from today\'s priorities'} title="Remove from today (the task is kept)" onClick={() => void save(ids.filter(x => x !== t.id))}><X size={15}/></button>
      </li>; })}</ul>
      : <p className="quiet-note">Nothing chosen yet. Pick up to {MAX_PRIORITIES} things that matter most today.</p>}
    <div className="priority-add">
      <label className="sr-only" htmlFor={'priority-add-' + label}>Add a priority</label>
      <select id={'priority-add-' + label} aria-label="Add a priority" value="" disabled={full || choices.length === 0} onChange={e => { if (e.target.value) void save([...ids, e.target.value]); }}>
        <option value="">{full ? `Today's list is full (${MAX_PRIORITIES})` : choices.length ? 'Add a priority…' : 'No open tasks to choose'}</option>
        {choices.map(t => <option key={t.id} value={t.id}>{t.title + ' · ' + (t.dueDate ? formatDue(t.dueDate, null).text : 'no due date')}</option>)}
      </select>
    </div>
    {carry.length > 0 && <p className="quiet-note carry-over">Unfinished from your last plan: {carry.map((t, i) => <span key={t.id}>{i > 0 && ', '}<button className="context-link" aria-label={'Carry over ' + t.title + ' to today'} disabled={full} onClick={() => void save([...ids, t.id])}>{t.title}</button></span>)}</p>}
    {message && <p role="alert" className="form-error">{message}</p>}
    <p className="time-zone-note">Priorities are a plan. They never change a task's due date, and removing one keeps the task.</p>
  </section>;
}
