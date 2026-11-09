import { useState } from 'react';
import { Pencil, Play, Plus, RotateCcw, X } from 'lucide-react';
import { Modal } from './components/Modal';
import { addWeeks, blockEnd, type BlockDraft, blockState, byStart, formatMinutes, goalProgress, hhmm, timeRange, totalsBetween, upcomingBlocks, weekEnd, weekStartOf, weekTotals } from './domain/study';
import { relativeDay } from './domain/format';
import { localDate } from './domain/scheduling';
import { workTypeLabels, type AcademicData, type Course } from './services/academic';
import type { StudyBlock, StudyData, StudyGoal } from './services/study';
import type { Task } from './services/workspace';

const dayText = (date: string, now: Date) => relativeDay(date, now);
const taskTitle = (tasks: Task[], id: string | null) => (id ? tasks.find(t => t.id === id)?.title ?? '' : '');

export function BlockDialog({ draft, setDraft, courses, academic, tasks, sourceContext, error, onSave, onClose }: {
  draft: BlockDraft | null; setDraft: (d: BlockDraft | null) => void; courses: Course[]; academic: AcademicData; tasks: Task[]; sourceContext?: string; error: string; onSave: (d: BlockDraft) => void; onClose: () => void;
}) {
  const related = draft ? academic.work.filter(w => w.courseId === draft.courseId).map(w => ({ link: w, task: tasks.find(t => t.id === w.taskId) })).filter(x => x.task && !x.task.completedAtMs || x.task?.id === draft.taskId) : [];
  const task = draft?.taskId ? tasks.find(t => t.id === draft.taskId) : undefined;
  const late = draft && task?.dueDate && draft.startDate > task.dueDate;
  return <Modal open={Boolean(draft)} title={draft?.isNew ? 'Schedule study' : 'Edit study block'} onClose={onClose}>{draft && <form onSubmit={e => { e.preventDefault(); onSave(draft); }}>
    <h2>{draft.isNew ? 'Schedule study' : 'Edit study block'}</h2>
    {sourceContext && <p className="time-zone-note">{sourceContext}</p>}
    <div className="form-grid">
      <label>Course<select value={draft.courseId} onChange={e => setDraft({ ...draft, courseId: e.target.value, taskId: null })}>{courses.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      <label>For coursework (optional)<select value={draft.taskId ?? ''} onChange={e => setDraft({ ...draft, taskId: e.target.value || null })}><option value="">General study</option>{related.map(x => <option key={x.task!.id} value={x.task!.id}>{workTypeLabels[x.link.workType]} · {x.task!.title}{x.task!.dueDate ? ' (due ' + x.task!.dueDate + ')' : ''}</option>)}</select></label>
    </div>
    <label>Objective (optional)<input maxLength={120} placeholder="Review chapters 4–6" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
    <div className="form-grid">
      <label>Date<input type="date" required value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })}/></label>
      <label>Start time<input type="time" required value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })}/></label>
      <label>Minutes<input type="number" required min={5} max={480} step={5} value={draft.durationMinutes} onChange={e => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}/></label>
    </div>
    {draft.startDate && draft.startTime && draft.durationMinutes >= 5 && <p className="time-zone-note">Ends {hhmm(blockEnd(draft))}{localDate(blockEnd(draft)) !== draft.startDate ? ' the next day' : ''}. This only reserves time; the Focus timer records what you actually study.</p>}
    {late && <p className="time-zone-note">This block is after the deadline ({task!.dueDate}). It will not move the deadline.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="dialog-actions"><span className="bar-spacer"/><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save study block</button></div>
  </form>}</Modal>;
}

export function GoalDialog({ course, goal, week, error, onSave, onClose }: { course: Course | null; goal: StudyGoal | null; week: string; error: string; onSave: (g: StudyGoal) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState<string>(goal?.weeklyMinutes ? String(goal.weeklyMinutes) : '');
  const [sessions, setSessions] = useState<string>(goal?.weeklySessions ? String(goal.weeklySessions) : '');
  if (!course) return <Modal open={false} title="Weekly goal" onClose={onClose}>{null}</Modal>;
  const build = (clear: boolean): StudyGoal => ({ courseId: course.id, effectiveWeek: week, weeklyMinutes: clear || !minutes ? null : Number(minutes), weeklySessions: clear || !sessions ? null : Number(sessions) });
  return <Modal open title={'Weekly goal for ' + course.code} onClose={onClose}><form onSubmit={e => { e.preventDefault(); onSave(build(false)); }}>
    <h2>Weekly goal · {course.code}</h2>
    <div className="form-grid"><label>Minutes per week<input type="number" min={1} max={10080} value={minutes} onChange={e => setMinutes(e.target.value)}/></label><label>Sessions per week<input type="number" min={1} max={100} value={sessions} onChange={e => setSessions(e.target.value)}/></label></div>
    <p className="time-zone-note">Counts completed Focus sessions only. Weeks run Monday to Sunday. Changes apply from the week of {week}; earlier weeks keep the target they had.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="dialog-actions">{goal && <button type="button" className="soft-button danger-link" onClick={() => onSave(build(true))}>Remove goal</button>}<span className="bar-spacer"/><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!minutes && !sessions}>Save goal</button></div>
  </form></Modal>;
}

/** The Study view: what is planned, how this week is going, and what has actually been studied. */
export function StudyView({ study, academic, courses, tasks, now, highlightBlock, schedule, editBlock, startBlock, startFocus, setCancelled, editGoal }: {
  study: StudyData; academic: AcademicData; courses: Course[]; tasks: Task[]; now: Date; highlightBlock: string | null;
  schedule: () => void; editBlock: (b: StudyBlock) => void; startBlock: (b: StudyBlock) => void; startFocus: () => void;
  setCancelled: (id: string, cancelled: boolean) => Promise<string | null>; editGoal: (c: Course) => void
}) {
  const [period, setPeriod] = useState<'week' | 'last' | 'all'>('week');
  const [message, setMessage] = useState('');
  const ids = new Set(courses.map(c => c.id));
  const code = (id: string) => academic.courses.find(c => c.id === id)?.code ?? '';
  const mine = { blocks: study.blocks.filter(b => ids.has(b.courseId)), sessions: study.sessions.filter(s => ids.has(s.courseId)) };
  const week = weekStartOf(now);
  const upcoming = upcomingBlocks(mine, now);
  const other = mine.blocks.filter(b => { const s = blockState(b, mine.sessions, now); return s === 'missed' || s === 'cancelled'; }).sort((a, b) => -byStart(a, b));
  const thisWeek = weekTotals(mine.sessions, week);
  const [from, to] = period === 'week' ? [week, weekEnd(week)] : period === 'last' ? [addWeeks(week, -1), weekEnd(addWeeks(week, -1))] : ['0000-01-01', '9999-12-31'];
  const shown = mine.sessions.filter(s => { const d = localDate(new Date(s.finishedAtMs)); return d >= from && d <= to; });
  const totals = totalsBetween(mine.sessions, from, to);
  const plannedMinutes = upcoming.filter(b => b.startDate >= week && b.startDate <= weekEnd(week)).reduce((n, b) => n + b.durationMinutes, 0);
  async function toggle(id: string, cancelled: boolean) { setMessage(await setCancelled(id, cancelled) ?? ''); }
  const blockRow = (b: StudyBlock, mode: 'upcoming' | 'other') => {
    const state = blockState(b, mine.sessions, now); const t = taskTitle(tasks, b.taskId);
    return <li key={b.id} className={'course-row' + (highlightBlock === b.id ? ' highlight' : '')} aria-current={highlightBlock === b.id ? 'true' : undefined}>
      <span className="course-row-text"><strong>{b.title || (t ? 'Study for ' + t : 'Study session')}</strong>
        <small>{[code(b.courseId), t && b.title ? t : '', dayText(b.startDate, now) + ' · ' + timeRange(b), b.durationMinutes + ' min'].filter(Boolean).join(' · ')}</small></span>
      {mode === 'other' && <span className={'tag' + (state === 'missed' ? ' overdue' : '')}>{state === 'missed' ? 'Missed' : 'Cancelled'}</span>}
      {mode === 'upcoming' && <><button className="soft-button" aria-label={'Start studying ' + (b.title || t || code(b.courseId))} onClick={() => startBlock(b)}><Play size={14}/> Start</button>
        <button className="icon-button" aria-label={'Edit study block ' + (b.title || t || code(b.courseId))} onClick={() => editBlock(b)}><Pencil size={15}/></button>
        <button className="icon-button" aria-label={'Cancel study block ' + (b.title || t || code(b.courseId))} title="Cancel this block" onClick={() => void toggle(b.id, true)}><X size={15}/></button></>}
      {mode === 'other' && state === 'missed' && <button className="soft-button" aria-label={'Reschedule ' + (b.title || t || code(b.courseId))} onClick={() => editBlock(b)}>Reschedule</button>}
      {mode === 'other' && state === 'cancelled' && <button className="icon-button" aria-label={'Restore study block ' + (b.title || t || code(b.courseId))} title="Restore" onClick={() => void toggle(b.id, false)}><RotateCcw size={15}/></button>}
    </li>;
  };
  if (!courses.length) return <div className="empty-state"><h2>No courses to study for</h2><p>Add a course to this semester, then schedule study time for it.</p></div>;
  return <div className="study-view">
    <div className="study-actions"><button className="primary-button" onClick={schedule}><Plus size={14}/> Schedule study</button><button className="soft-button" onClick={startFocus}><Play size={14}/> Start a focus session</button></div>
    {message && <p role="alert" className="form-error">{message}</p>}
    <section className="school-section" aria-labelledby="study-up-heading"><h2 id="study-up-heading">Planned study</h2>
      {upcoming.length ? <ul className="course-list" aria-label="Upcoming study blocks">{upcoming.map(b => blockRow(b, 'upcoming'))}</ul> : <p className="quiet-note">Nothing scheduled. Reserve time for a course or an upcoming exam.</p>}
      {other.length > 0 && <details className="more-options school-more"><summary>Missed and cancelled ({other.length})</summary><ul className="course-list" aria-label="Missed and cancelled study blocks">{other.map(b => blockRow(b, 'other'))}</ul><p className="time-zone-note">Missed and cancelled blocks never count as studied time.</p></details>}
    </section>
    <section className="school-section" aria-labelledby="study-week-heading"><h2 id="study-week-heading">This week</h2>
      <p className="quiet-note" aria-label="Weekly study totals">Studied {formatMinutes(thisWeek.minutes)} in {thisWeek.sessions} {thisWeek.sessions === 1 ? 'session' : 'sessions'}{plannedMinutes ? ' · ' + formatMinutes(plannedMinutes) + ' still planned' : ''}</p>
      <ul className="goal-list" aria-label="Weekly study goals">{courses.map(c => { const p = goalProgress(study, c.id, week);
        return <li key={c.id} className="goal-row"><span className="goal-name"><strong>{c.code}</strong>
          {p ? <small>{[p.goal.weeklyMinutes !== null ? formatMinutes(p.totals.minutes) + ' of ' + formatMinutes(p.goal.weeklyMinutes) : '', p.goal.weeklySessions !== null ? p.totals.sessions + ' of ' + p.goal.weeklySessions + ' sessions' : ''].filter(Boolean).join(' · ')}{p.met ? ' · goal met' : ''}</small> : <small>{weekTotals(mine.sessions, week, c.id).minutes ? formatMinutes(weekTotals(mine.sessions, week, c.id).minutes) + ' studied · no weekly goal' : 'No weekly goal'}</small>}</span>
          {p && p.goal.weeklyMinutes !== null && <progress max={p.goal.weeklyMinutes} value={Math.min(p.totals.minutes, p.goal.weeklyMinutes)} aria-label={'Weekly study progress for ' + c.code}/>}
          <button className="soft-button" aria-label={(p ? 'Edit weekly goal for ' : 'Set weekly goal for ') + c.code} onClick={() => editGoal(c)}>{p ? 'Edit goal' : 'Set goal'}</button></li>; })}</ul>
    </section>
    <section className="school-section" aria-labelledby="study-history-heading"><h2 id="study-history-heading">Study history</h2>
      <div className="segmented" role="group" aria-label="History period">{([['week', 'This week'], ['last', 'Last week'], ['all', 'All time']] as const).map(([id, label]) => <button key={id} className={period === id ? 'active' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}</div>
      {shown.length ? <><p className="quiet-note" aria-label="History totals">{totals.sessions} completed {totals.sessions === 1 ? 'session' : 'sessions'} · {formatMinutes(totals.minutes)} studied</p>
        <ul className="course-list" aria-label="Completed study sessions">{shown.slice(0, 8).map(s => <li key={s.id} className="course-row"><span className="course-row-text"><strong>{code(s.courseId)}{taskTitle(tasks, s.taskId) ? ' · ' + taskTitle(tasks, s.taskId) : ''}</strong><small>{formatMinutes(Math.round(s.creditedMs / 60_000))} · {new Date(s.finishedAtMs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></span></li>)}</ul>
        {shown.length > 8 && <details className="more-options"><summary>Show {shown.length - 8} earlier sessions</summary><ul className="course-list">{shown.slice(8).map(s => <li key={s.id} className="course-row"><span className="course-row-text"><strong>{code(s.courseId)}{taskTitle(tasks, s.taskId) ? ' · ' + taskTitle(tasks, s.taskId) : ''}</strong><small>{formatMinutes(Math.round(s.creditedMs / 60_000))} · {new Date(s.finishedAtMs).toLocaleDateString()}</small></span></li>)}</ul></details>}</>
        : <div className="empty-state"><h2>No completed study sessions {period === 'all' ? 'yet' : 'in this period'}</h2><p>Finish a Focus session from a course, an assignment or a study block and it will be recorded here.</p></div>}
    </section>
  </div>;
}
