import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, weekStart } from '../domain/dates';
import { quantity, weeklyReview } from '../domain/personal';
import type { PersonalData } from '../services/personal';
import type { Task } from '../services/workspace';
import { plural, shortDate } from './format';

/** A short reflection on one Monday–Sunday week, counted from authoritative records only. No scores, no generated text. */
export function WeekView({ personal, tasks, today }: { personal: PersonalData; tasks: Task[]; today: string }) {
  const [anchor, setAnchor] = useState(weekStart(today));
  const review = weeklyReview(anchor, personal, tasks, today);
  const current = anchor === weekStart(today);
  return <div className="personal-view week-view">
    <div className="button-row week-nav">
      <button className="icon-button" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft size={18}/></button>
      <strong aria-live="polite">{current ? 'This week' : 'Week of'} · {shortDate(review.start)} – {shortDate(review.end)}</strong>
      <button className="icon-button" aria-label="Next week" disabled={current} onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight size={18}/></button>
      {!current && <button className="soft-button" onClick={() => setAnchor(weekStart(today))}>This week</button>}
    </div>
    {!review.hasActivity ? <div className="empty-state"><h2>Nothing recorded {current ? 'yet this week' : 'this week'}</h2><p>Completed personal tasks, habit check-ins, finished routines and logged progress appear here. Planned or scheduled work is not counted until it is done.</p></div>
      : <div className="review-grid">
        <section aria-labelledby="rv-tasks"><h2 id="rv-tasks">Tasks</h2><p>{plural(review.tasksCompleted, 'personal task')} completed.</p>
          {review.priorities.planned > 0 && <p>{review.priorities.completed} of {plural(review.priorities.planned, 'priority', 'priorities')} finished.</p>}</section>
        <section aria-labelledby="rv-habits"><h2 id="rv-habits">Habits</h2>
          {review.habits.length ? <ul className="course-list" aria-label="Habit consistency this week">{review.habits.map(h => <li key={h.habit.id} className="course-row"><span className="course-row-text"><strong>{h.habit.name}</strong><small>{h.done} of {h.expected} {h.expected === 1 ? 'time' : 'times'}{h.habit.status === 'paused' ? ' · paused' : ''}</small></span></li>)}</ul> : <p className="quiet-note">No habits yet.</p>}</section>
        <section aria-labelledby="rv-routines"><h2 id="rv-routines">Routines</h2><p>{plural(review.routines.completed, 'run')} completed{review.routines.partial ? `, ${review.routines.partial} partly done` : ''}.</p></section>
        <section aria-labelledby="rv-goals"><h2 id="rv-goals">Goals</h2>
          {review.goals.length ? <ul className="course-list" aria-label="Goal progress this week">{review.goals.map(g => <li key={g.goal.id} className="course-row"><span className="course-row-text"><strong>{g.goal.title}</strong><small>{g.completedThisWeek ? 'Completed this week' : g.goal.kind === 'binary' ? 'Not done yet' : g.added > 0 ? '+' + quantity(g.added, g.goal.unit) + ' this week' : 'No progress logged'}</small></span></li>)}</ul> : <p className="quiet-note">No goals yet.</p>}</section>
        <section aria-labelledby="rv-open"><h2 id="rv-open">Still open</h2><p>{review.outstanding.overdue ? plural(review.outstanding.overdue, 'overdue personal task') + '. ' : ''}{current ? plural(review.outstanding.dueThisWeek, 'personal task') + ' due in the rest of this week.' : ''}</p></section>
      </div>}
    <p className="time-zone-note">School and Engineering progress are not included here; they have their own pages.</p>
  </div>;
}
