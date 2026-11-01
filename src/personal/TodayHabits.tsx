import { Check } from 'lucide-react';
import { habitLine, habitStats, routinesForToday, runFor, runProgress } from '../domain/personal';
import type { PersonalData } from '../services/personal';
import type { PersonalOps, PersonalTab, Run } from './shared';
import { plural } from './format';

/** Habits still due today and routines available today, in one compact list. Renders nothing when there is nothing to show. */
export function TodayHabits({ personal, today, ops, run, onProgress, openPersonal, headingId }: {
  personal: PersonalData; today: string; ops: PersonalOps; run: Run; onProgress: () => void; openPersonal: (tab: PersonalTab) => void; headingId: string;
}) {
  const due = personal.habits.map(h => ({ habit: h, stats: habitStats(h, personal.habitSchedules, personal.habitCheckins, today) })).filter(x => x.stats.due);
  const routines = routinesForToday(personal.routines, today);
  if (!due.length && !routines.length) return null;
  return <section aria-labelledby={headingId}>
    <h2 id={headingId}>Habits and routines</h2>
    <ul className="day-list" aria-label="Habits and routines for today">
      {due.map(({ habit, stats }) => <li key={habit.id} className="day-row">
        <button className="task-check" aria-label={'Check in ' + habit.name} onClick={() => void run(() => ops.setHabitCheckin(habit.id, today, true, today)).then(m => { if (!m) onProgress(); })}/>
        <span className="day-row-text"><strong>{habit.name}</strong><small>{habitLine(stats)}</small></span></li>)}
      {routines.map(r => { const todays = runFor(personal.executions, r.id, today); const prog = todays ? runProgress(todays) : null;
        return <li key={r.id} className="day-row"><span className="day-time">Routine</span>
          <span className="day-row-text"><strong>{r.name}</strong><small>{todays?.completedAtMs ? 'Done today' : prog ? `In progress · ${prog.done} of ${prog.total}` : plural(r.steps.length, 'step')}</small></span>
          {!todays?.completedAtMs && <button className="soft-button" aria-label={(todays ? 'Continue ' : 'Start ') + r.name + ' routine'} onClick={() => void (todays ? Promise.resolve(null) : run(() => ops.startRoutine(r.id, crypto.randomUUID(), today, today))).then(m => { if (!m) openPersonal('routines'); })}>{todays ? 'Continue' : <><Check size={13}/> Start</>}</button>}</li>; })}
    </ul>
  </section>;
}
