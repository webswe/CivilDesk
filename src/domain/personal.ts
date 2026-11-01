/**
 * Pure calculations for the Personal area. They take records plus an explicit `today`, so every result is
 * deterministic and none of them reads the clock. Nothing here writes: progress, streaks and reviews are
 * always derived from the authoritative records, never stored.
 */
import { addDays, periodEnd, periodStart, toDays, weekStart, weekday, weekdayNames, type Period } from './dates';
import { localDate } from './scheduling';
import { taskArea } from './areas';
import type { Task } from '../services/workspace';
import type { DailyPriority, Goal, GoalEntry, GoalTarget, Habit, HabitCheckin, HabitSchedule, Occurrence, PersonalData, RecurrenceRule, Routine, RoutineExecution } from '../services/personal';

const localDay = (ms: number) => localDate(new Date(ms));

// ---------------------------------------------------------------- goals
export const liveEntries = (entries: GoalEntry[], goalId: string) => entries.filter(e => e.goalId === goalId && e.voidedAtMs === null);
/** The target that applied on `date`: the latest row that took effect on or before it. */
export function targetAt(goal: Goal, targets: GoalTarget[], date: string): number | null {
  if (goal.kind !== 'periodic') return goal.target;
  const row = targets.filter(t => t.goalId === goal.id && t.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return row ? row.target : goal.target;
}
export interface PeriodProgress { start: string; end: string; total: number; target: number | null; met: boolean }
export function periodProgress(goal: Goal, targets: GoalTarget[], entries: GoalEntry[], date: string): PeriodProgress {
  const period = goal.period ?? 'weekly'; const start = periodStart(period, date); const end = periodEnd(period, date);
  const total = liveEntries(entries, goal.id).filter(e => e.entryDate >= start && e.entryDate <= end).reduce((n, e) => n + e.amount, 0);
  const target = targetAt(goal, targets, start);
  return { start, end, total, target, met: target !== null && total >= target };
}
/** Past periods, newest first, from the goal's first period to the one before the current. Each keeps its own target. */
export function periodHistory(goal: Goal, targets: GoalTarget[], entries: GoalEntry[], today: string, limit = 8): PeriodProgress[] {
  if (goal.kind !== 'periodic' || !goal.period) return [];
  const out: PeriodProgress[] = []; const first = periodStart(goal.period, goal.startDate);
  let cursor = periodStart(goal.period, today);
  while (out.length < limit) {
    cursor = addDays(cursor, -1); const start = periodStart(goal.period, cursor);
    if (start < first) break;
    out.push(periodProgress(goal, targets, entries, start)); cursor = start;
  }
  return out;
}
export interface GoalSummary { total: number; target: number | null; fraction: number | null; reached: boolean; period: PeriodProgress | null }
export function goalSummary(goal: Goal, targets: GoalTarget[], entries: GoalEntry[], today: string): GoalSummary {
  if (goal.kind === 'binary') return { total: goal.status === 'completed' ? 1 : 0, target: 1, fraction: goal.status === 'completed' ? 1 : 0, reached: goal.status === 'completed', period: null };
  if (goal.kind === 'periodic') {
    const period = periodProgress(goal, targets, entries, today);
    return { total: period.total, target: period.target, fraction: period.target ? Math.min(1, period.total / period.target) : null, reached: period.met, period };
  }
  const total = liveEntries(entries, goal.id).reduce((n, e) => n + e.amount, 0);
  return { total, target: goal.target, fraction: goal.target ? Math.min(1, total / goal.target) : null, reached: goal.target !== null && total >= goal.target, period: null };
}
export const periodNoun: Record<Period, string> = { daily: 'today', weekly: 'this week', monthly: 'this month' };
export const quantity = (n: number, unit: string) => n.toLocaleString() + (unit ? ' ' + unit : '');

// ---------------------------------------------------------------- habits
export function scheduleAt(schedules: HabitSchedule[], habitId: string, date: string): HabitSchedule | undefined {
  return schedules.filter(s => s.habitId === habitId && s.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
export interface HabitStats {
  schedule: HabitSchedule | undefined; unit: 'day' | 'week';
  currentStreak: number; bestStreak: number; completed: number;
  doneToday: boolean; thisWeek: { done: number; target: number };
  /** Share of expected occurrences met recently: last 14 days (daily) or last 4 finished weeks (weekly). Null when nothing is expected yet. */
  adherence: { met: number; of: number; unit: 'days' | 'weeks' } | null;
  due: boolean;
  recent: { date: string; done: boolean; beforeStart: boolean }[];
}
export function habitStats(habit: Habit, schedules: HabitSchedule[], checkins: HabitCheckin[], today: string): HabitStats {
  const mine = new Set(checkins.filter(c => c.habitId === habit.id).map(c => c.occurrenceDate));
  const sched = scheduleAt(schedules, habit.id, today);
  const kind = sched?.frequency ?? 'daily';
  // Streaks only span the stretch of history that used the current kind of schedule (days or weeks). A streak
  // across a switch between daily and weekly would compare unlike things, so it starts at the switch.
  const history = schedules.filter(s => s.habitId === habit.id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let windowStart = habit.startDate;
  for (let i = history.length - 1; i >= 0 && history[i]!.frequency === kind; i--) windowStart = history[i]!.effectiveFrom > habit.startDate ? history[i]!.effectiveFrom : habit.startDate;
  const weekDone = (monday: string) => { let n = 0; for (let d = 0; d < 7; d++) if (mine.has(addDays(monday, d))) n++; return n; };
  const thisMonday = weekStart(today);
  const thisWeek = { done: weekDone(thisMonday), target: sched ? (sched.frequency === 'daily' ? 7 : sched.targetCount) : 7 };
  let current = 0; let best = 0; let adherence: HabitStats['adherence'] = null;
  if (kind === 'daily') {
    const firstDay = windowStart;
    let run = 0;
    for (let d = firstDay; d <= today; d = addDays(d, 1)) { if (mine.has(d)) { run++; best = Math.max(best, run); } else if (d < today) run = 0; }
    for (let d = mine.has(today) ? today : addDays(today, -1); d >= firstDay && mine.has(d); d = addDays(d, -1)) current++;
    const from = addDays(today, -13) > habit.startDate ? addDays(today, -13) : habit.startDate;
    let met = 0; let of = 0;
    for (let d = from; d <= today; d = addDays(d, 1)) { if (mine.has(d)) { met++; of++; } else if (d < today) of++; }
    adherence = of ? { met, of, unit: 'days' } : null;
  } else {
    const weeks: { monday: string; met: boolean | null }[] = [];
    for (let monday = weekStart(windowStart); monday <= thisMonday; monday = addDays(monday, 7)) {
      const target = scheduleAt(schedules, habit.id, monday)?.targetCount ?? 1; const done = weekDone(monday);
      // A week that began before the habit did is not held against it: it counts if met and is otherwise neutral.
      weeks.push({ monday, met: done >= target ? true : monday < habit.startDate ? null : false });
    }
    let run = 0;
    for (const w of weeks) { if (w.met === true) { run++; best = Math.max(best, run); } else if (w.met === false && w.monday < thisMonday) run = 0; }
    for (let i = weeks.length - 1; i >= 0; i--) { const w = weeks[i]!; if (w.met === true) current++; else if (w.monday !== thisMonday) break; }
    const finished = weeks.filter(w => w.monday < thisMonday && w.met !== null).slice(-4);
    adherence = finished.length ? { met: finished.filter(w => w.met).length, of: finished.length, unit: 'weeks' } : null;
  }
  const doneToday = mine.has(today);
  const preferred = sched?.preferredDays ?? [];
  const due = habit.status === 'active' && habit.startDate <= today && (kind === 'daily' ? !doneToday : thisWeek.done < thisWeek.target && !doneToday && (preferred.length === 0 || preferred.includes(weekday(today))));
  const recent = Array.from({ length: 14 }, (_, i) => { const date = addDays(today, i - 13); return { date, done: mine.has(date), beforeStart: date < habit.startDate }; });
  return { schedule: sched, unit: kind === 'daily' ? 'day' : 'week', currentStreak: current, bestStreak: best, completed: mine.size, doneToday, thisWeek, adherence, due, recent };
}
const plural = (n: number, one: string) => n + ' ' + (n === 1 ? one : one + 's');
/** The one-line consistency summary. A streak is only shown in the unit the habit is measured in (days or weeks). */
export function habitLine(stats: HabitStats): string {
  const parts: string[] = [describeSchedule(stats.schedule)];
  if (stats.unit === 'week') parts.push(`${stats.thisWeek.done} of ${stats.thisWeek.target} this week`);
  parts.push(stats.currentStreak > 0 ? `Streak ${plural(stats.currentStreak, stats.unit)}` : 'No streak yet');
  if (stats.bestStreak > stats.currentStreak) parts.push(`Best ${plural(stats.bestStreak, stats.unit)}`);
  return parts.filter(Boolean).join(' · ');
}

export function describeSchedule(s: HabitSchedule | undefined): string {
  if (!s) return '';
  if (s.frequency === 'daily') return 'Every day';
  const days = s.preferredDays.length ? ' · ' + s.preferredDays.map(d => weekdayNames[d]).join(', ') : '';
  return (s.targetCount === 1 ? 'Once' : s.targetCount + ' times') + ' a week' + days;
}

// ---------------------------------------------------------------- routines
export const runFor = (executions: RoutineExecution[], routineId: string, date: string) => executions.find(e => e.routineId === routineId && e.occurrenceDate === date);
export const runProgress = (run: RoutineExecution) => ({ done: run.steps.filter(s => s.doneAtMs !== null).length, total: run.steps.length });
export const scheduledOn = (routine: Routine, date: string) => routine.scheduleDays.includes(weekday(date));
export function describeRoutineSchedule(r: Routine): string {
  if (!r.scheduleDays.length) return 'No schedule';
  const days = r.scheduleDays.length === 7 ? 'Every day' : r.scheduleDays.map(d => weekdayNames[d]).join(', ');
  return days + (r.scheduleTime ? ' at ' + r.scheduleTime : '');
}
/** Active routines that are scheduled today or have no schedule (available whenever you want them). */
export const routinesForToday = (routines: Routine[], today: string) => routines.filter(r => r.status === 'active' && (r.scheduleDays.length === 0 || scheduledOn(r, today)));

// ---------------------------------------------------------------- recurring responsibilities
export function describeRule(rule: RecurrenceRule): string {
  if (rule.frequency === 'daily') return 'Every day';
  if (rule.frequency === 'weekly') return 'Every ' + rule.weekdays.map(d => weekdayNames[d]).join(', ');
  const day = rule.monthDay ?? 1;
  return 'Monthly on the ' + day + ordinal(day) + (day > 28 ? ' (last day of shorter months)' : '');
}
const ordinal = (n: number) => n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
/** The next dated occurrence that is still open: an existing, unfinished task on or after today. */
export function nextOccurrence(rule: RecurrenceRule, occurrences: Occurrence[], tasks: Task[], today: string): { date: string; taskId: string } | null {
  const open = occurrences.filter(o => o.ruleId === rule.id && o.status === 'open' && o.taskId && o.occurrenceDate >= today)
    .filter(o => { const t = tasks.find(x => x.id === o.taskId); return t && !t.completedAtMs; })
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))[0];
  return open ? { date: open.occurrenceDate, taskId: open.taskId! } : null;
}
export const occurrenceRuleByTask = (occurrences: Occurrence[], rules: RecurrenceRule[]): Map<string, RecurrenceRule> => {
  const map = new Map<string, RecurrenceRule>();
  for (const o of occurrences) { const r = rules.find(x => x.id === o.ruleId); if (o.taskId && r) map.set(o.taskId, r); }
  return map;
};
export const skippedFrom = (rule: RecurrenceRule, occurrences: Occurrence[], today: string) => occurrences.filter(o => o.ruleId === rule.id && o.status === 'skipped' && o.occurrenceDate >= today).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));

// ---------------------------------------------------------------- daily priorities
export const prioritiesFor = (date: string, priorities: DailyPriority[], tasks: Task[]): Task[] =>
  priorities.filter(p => p.planDate === date).sort((a, b) => a.position - b.position).flatMap(p => { const t = tasks.find(x => x.id === p.taskId); return t ? [t] : []; });
/** Open tasks that were priorities on the most recent earlier planned day and are not planned for `today`. */
export function carryOver(today: string, priorities: DailyPriority[], tasks: Task[]): Task[] {
  const earlier = priorities.filter(p => p.planDate < today).map(p => p.planDate).sort().pop();
  if (!earlier) return [];
  const planned = new Set(priorities.filter(p => p.planDate === today).map(p => p.taskId));
  return prioritiesFor(earlier, priorities, tasks).filter(t => !t.completedAtMs && !planned.has(t.id));
}
export const isPersonalTask = (t: Task, occurrenceIds?: Set<string>) => occurrenceIds?.has(t.id) || taskArea(t.category, Boolean(t.projectId)) === 'personal';

// ---------------------------------------------------------------- weekly review
export interface WeeklyReview {
  start: string; end: string; hasActivity: boolean;
  tasksCompleted: number;
  priorities: { planned: number; completed: number };
  habits: { habit: Habit; done: number; expected: number }[];
  routines: { completed: number; partial: number };
  goals: { goal: Goal; added: number; completedThisWeek: boolean }[];
  outstanding: { overdue: number; dueThisWeek: number };
}
/** Everything is counted from authoritative records for the Monday–Sunday week containing `date`. Nothing scheduled-but-unfinished is counted as done. */
export function weeklyReview(date: string, data: PersonalData, tasks: Task[], today: string): WeeklyReview {
  const start = weekStart(date); const end = addDays(start, 6);
  const inWeek = (d: string) => d >= start && d <= end;
  const occurrenceIds = new Set(data.occurrences.flatMap(o => o.taskId ? [o.taskId] : []));
  const personal = tasks.filter(t => isPersonalTask(t, occurrenceIds));
  const completedIn = (t: Task) => !!t.completedAtMs && inWeek(localDay(t.completedAtMs));
  const planned = new Set(data.priorities.filter(p => inWeek(p.planDate)).map(p => p.taskId));
  const habits = data.habits.filter(h => h.status !== 'archived' && h.startDate <= end).map(habit => {
    const mine = data.habitCheckins.filter(c => c.habitId === habit.id && inWeek(c.occurrenceDate));
    const s = scheduleAt(data.habitSchedules, habit.id, start);
    const lastDay = end < today ? end : today; const firstDay = habit.startDate > start ? habit.startDate : start;
    const days = lastDay >= firstDay ? toDays(lastDay) - toDays(firstDay) + 1 : 0;
    return { habit, done: mine.length, expected: s?.frequency === 'weekly' ? s.targetCount : days };
  });
  const runs = data.executions.filter(e => inWeek(e.occurrenceDate));
  const goals = data.goals.filter(g => g.status !== 'archived').map(goal => ({
    goal,
    added: liveEntries(data.goalEntries, goal.id).filter(e => inWeek(e.entryDate)).reduce((n, e) => n + e.amount, 0),
    completedThisWeek: goal.completedAtMs !== null && inWeek(localDay(goal.completedAtMs)),
  })).filter(g => g.added > 0 || g.completedThisWeek || g.goal.status === 'active');
  const open = personal.filter(t => !t.completedAtMs && t.dueDate);
  const review: WeeklyReview = {
    start, end, hasActivity: false,
    tasksCompleted: personal.filter(completedIn).length,
    priorities: { planned: planned.size, completed: [...planned].filter(id => { const t = tasks.find(x => x.id === id); return !!t && completedIn(t); }).length },
    habits, routines: { completed: runs.filter(r => r.completedAtMs !== null).length, partial: runs.filter(r => r.completedAtMs === null && r.steps.some(s => s.doneAtMs !== null)).length },
    goals,
    outstanding: { overdue: open.filter(t => t.dueDate! < today).length, dueThisWeek: open.filter(t => t.dueDate! >= (today > start ? today : start) && t.dueDate! <= end).length },
  };
  review.hasActivity = review.tasksCompleted > 0 || review.priorities.planned > 0 || review.habits.some(h => h.done > 0) || review.routines.completed + review.routines.partial > 0 || review.goals.some(g => g.added > 0 || g.completedThisWeek);
  return review;
}
