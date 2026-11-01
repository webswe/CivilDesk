import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { describeRoutineSchedule, runFor, runProgress } from '../domain/personal';
import type { PersonalData, Routine, RoutineExecution, RoutineInput } from '../services/personal';
import { FormDialog, WeekdayPicker, type PersonalOps, type Run } from './shared';
import { clock, plural, shortDate } from './format';

const draftFor = (routine?: Routine): RoutineInput => routine
  ? { id: routine.id, name: routine.name, description: routine.description, scheduleDays: routine.scheduleDays, scheduleTime: routine.scheduleTime, steps: routine.steps.map(s => ({ ...s })) }
  : { id: crypto.randomUUID(), name: '', description: '', scheduleDays: [], scheduleTime: null, steps: [{ id: crypto.randomUUID(), title: '' }] };

/** The checklist for one run. Checking a step saves it at once, so partial progress survives closing the app. */
export function RoutineRun({ routine, run: execution, ops, runOp, onDone }: { routine: Routine; run: RoutineExecution; ops: PersonalOps; runOp: Run; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const progress = runProgress(execution); const complete = execution.completedAtMs !== null;
  return <div className="routine-run" role="group" aria-label={'Checklist for ' + routine.name}>
    <ul className="routine-steps">{execution.steps.map(s => <li key={s.position}><label className="check-row routine-step"><input type="checkbox" checked={s.doneAtMs !== null} disabled={complete} onChange={e => void runOp(() => ops.setRoutineStep(execution.id, s.position, e.target.checked)).then(m => setMessage(m ?? ''))}/><span className={s.doneAtMs !== null ? 'step-done' : ''}>{s.title}</span></label></li>)}</ul>
    {complete ? <p className="quiet-note">Completed today at {clock(execution.completedAtMs!)} · {plural(progress.total, 'step')}</p>
      : <div className="button-row"><button className="primary-button" disabled={progress.done < progress.total} onClick={() => void runOp(() => ops.completeRoutine(execution.id)).then(m => { setMessage(m ?? ''); if (!m) onDone(); })}><Check size={14}/> Finish routine</button><span className="quiet-note" aria-live="polite">{progress.done} of {progress.total} steps{progress.done < progress.total ? ' · you can come back later; progress is saved' : ''}</span></div>}
    {message && <p role="alert" className="form-error">{message}</p>}
  </div>;
}

export function RoutinesView({ data, today, ops, run, onDone }: { data: PersonalData; today: string; ops: PersonalOps; run: Run; onDone: () => void }) {
  const [draft, setDraft] = useState<RoutineInput | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editing = draft ? data.routines.some(r => r.id === draft.id) : false;
  const patch = (v: Partial<RoutineInput>) => setDraft(d => d ? { ...d, ...v } : d);
  const moveStep = (i: number, by: number) => setDraft(d => { if (!d) return d; const steps = [...d.steps]; const [s] = steps.splice(i, 1); steps.splice(i + by, 0, s!); return { ...d, steps }; });
  const active = data.routines.filter(r => r.status === 'active'); const others = data.routines.filter(r => r.status !== 'active');
  async function start(routine: Routine) { setNotice(await run(() => ops.startRoutine(routine.id, crypto.randomUUID(), today, today)) ?? ''); setOpen(routine.id); }
  async function save() {
    if (!draft) return;
    const message = await run(() => ops.saveRoutine({ ...draft, scheduleTime: draft.scheduleTime || null }));
    if (message) setError(message); else { setDraft(null); setError(''); }
  }
  const row = (routine: Routine) => {
    const todays = runFor(data.executions, routine.id, today); const isOpen = open === routine.id;
    const past = data.executions.filter(e => e.routineId === routine.id && e.occurrenceDate !== today).slice(0, 8);
    const progress = todays ? runProgress(todays) : null;
    return <li key={routine.id} className="routine-item">
      <div className="goal-row">
        <span className="goal-name"><strong>{routine.name}</strong><small>{[describeRoutineSchedule(routine), plural(routine.steps.length, 'step'), todays ? (todays.completedAtMs ? 'Done today' : `In progress · ${progress!.done} of ${progress!.total}`) : '', routine.status !== 'active' ? routine.status[0]!.toUpperCase() + routine.status.slice(1) : ''].filter(Boolean).join(' · ')}</small></span>
        {routine.status === 'active' && !todays && <button className="soft-button" aria-label={'Start ' + routine.name} onClick={() => void start(routine)}><Play size={14}/> Start</button>}
        {routine.status === 'active' && todays && !todays.completedAtMs && <button className="soft-button" aria-label={'Continue ' + routine.name} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : routine.id)}>{isOpen ? 'Hide checklist' : 'Continue'}</button>}
        <button className="icon-button" aria-label={'Edit ' + routine.name} onClick={() => { setError(''); setDraft(draftFor(routine)); }}><Pencil size={15}/></button>
      </div>
      {todays && !todays.completedAtMs && routine.status === 'active' && isOpen && <RoutineRun routine={routine} run={todays} ops={ops} runOp={run} onDone={onDone}/>}
      {todays?.completedAtMs && <p className="quiet-note routine-done">Completed today at {clock(todays.completedAtMs)}</p>}
      <details className="more-options"><summary>History and options</summary>
        {past.length ? <ul className="course-list" aria-label={'Previous runs of ' + routine.name}>{past.map(e => { const p = runProgress(e); return <li key={e.id} className="course-row"><span className="course-row-text"><strong>{shortDate(e.occurrenceDate)}</strong><small>{e.completedAtMs ? `Completed · ${plural(p.total, 'step')}` : `Partly done · ${p.done} of ${p.total} steps`}</small></span></li>; })}</ul> : <p className="quiet-note">No earlier runs yet.</p>}
        <div className="button-row">
          {routine.status === 'active' && <button className="soft-button" onClick={() => void run(() => ops.setRoutineStatus(routine.id, 'paused'))}>Pause</button>}
          {routine.status === 'paused' && <button className="soft-button" onClick={() => void run(() => ops.setRoutineStatus(routine.id, 'active'))}>Resume</button>}
          {routine.status !== 'archived' && <button className="soft-button" onClick={() => void run(() => ops.setRoutineStatus(routine.id, 'archived'))}>Archive</button>}
          {routine.status === 'archived' && <button className="soft-button" onClick={() => void run(() => ops.setRoutineStatus(routine.id, 'active'))}>Restore</button>}
        </div>
      </details>
    </li>;
  };
  return <div className="personal-view">
    <div className="study-actions"><button className="primary-button" onClick={() => { setError(''); setDraft(draftFor()); }}><Plus size={14}/> New routine</button></div>
    {notice && <p role="alert" className="form-error">{notice}</p>}
    {data.routines.length === 0 ? <div className="empty-state"><h2>No routines yet</h2><p>A routine is an ordered checklist you repeat, like a morning or evening routine. Each run is saved on its own day; steps are not tasks.</p></div>
      : <section className="school-section" aria-labelledby="routines-heading"><h2 id="routines-heading">Routines</h2>
        {active.length ? <ul className="goal-list" aria-label="Routines">{active.map(row)}</ul> : <p className="quiet-note">No active routines right now.</p>}
        {others.length > 0 && <details className="more-options school-more"><summary>Paused and archived ({others.length})</summary><ul className="goal-list" aria-label="Paused and archived routines">{others.map(row)}</ul></details>}
      </section>}
    {draft && <FormDialog title={editing ? 'Edit routine' : 'New routine'} submitLabel="Save routine" error={error} onClose={() => { setDraft(null); setError(''); }} onSubmit={() => void save()}>
      <label>Name<input autoFocus required maxLength={120} value={draft.name} onChange={e => patch({ name: e.target.value })}/></label>
      <fieldset className="subtasks"><legend>Steps, in order</legend>
        {draft.steps.map((s, i) => <div className="subtask-row" key={s.id}>
          <input aria-label={'Step ' + (i + 1)} required maxLength={200} value={s.title} onChange={e => patch({ steps: draft.steps.map(x => x.id === s.id ? { ...x, title: e.target.value } : x) })}/>
          <button type="button" className="icon-button" aria-label={'Move step ' + (i + 1) + ' up'} disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp size={15}/></button>
          <button type="button" className="icon-button" aria-label={'Move step ' + (i + 1) + ' down'} disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown size={15}/></button>
          <button type="button" className="icon-button" aria-label={'Remove step ' + (i + 1)} disabled={draft.steps.length === 1} onClick={() => patch({ steps: draft.steps.filter(x => x.id !== s.id) })}><Trash2 size={15}/></button>
        </div>)}
        <button type="button" className="soft-button" disabled={draft.steps.length >= 40} onClick={() => patch({ steps: [...draft.steps, { id: crypto.randomUUID(), title: '' }] })}><Plus size={14}/> Add step</button>
      </fieldset>
      <WeekdayPicker legend="Usual days (optional)" value={draft.scheduleDays} onChange={scheduleDays => patch({ scheduleDays, scheduleTime: scheduleDays.length ? draft.scheduleTime : null })}/>
      <label>Usual time (optional)<input type="time" disabled={draft.scheduleDays.length === 0} value={draft.scheduleTime ?? ''} onChange={e => patch({ scheduleTime: e.target.value || null })}/></label>
      <p className="time-zone-note">A routine with days and a time also appears in the Calendar on those days. Editing steps never changes runs you already did.</p>
      <details className="more-options" open={Boolean(draft.description)}><summary>Notes</summary><label>Description<textarea rows={3} maxLength={2000} value={draft.description} onChange={e => patch({ description: e.target.value })}/></label></details>
    </FormDialog>}
  </div>;
}
