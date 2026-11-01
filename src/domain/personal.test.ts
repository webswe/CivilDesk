import { describe, expect, it } from 'vitest';
import { carryOver, describeRule, describeSchedule, goalSummary, habitStats, nextOccurrence, periodHistory, periodProgress, prioritiesFor, routinesForToday, runProgress, targetAt, weeklyReview } from './personal';
import type { DailyPriority, Goal, GoalEntry, GoalTarget, Habit, HabitCheckin, HabitSchedule, Occurrence, PersonalData, RecurrenceRule, Routine, RoutineExecution } from '../services/personal';
import type { Task } from '../services/workspace';

const TODAY = '2026-11-04'; // Wednesday
const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g', title: 'Read', description: '', kind: 'numeric', target: 300, unit: 'pages', period: null, startDate: '2026-10-01', targetDate: null, status: 'active', completedAtMs: null, createdAtMs: 1, updatedAtMs: 1, ...over });
const entry = (id: string, date: string, amount: number, voided = false): GoalEntry => ({ id, goalId: 'g', entryDate: date, amount, note: '', createdAtMs: 1, voidedAtMs: voided ? 2 : null });
const habit = (over: Partial<Habit> = {}): Habit => ({ id: 'h', name: 'Read', description: '', status: 'active', startDate: '2026-10-01', createdAtMs: 1, updatedAtMs: 1, ...over });
const sched = (from: string, frequency: 'daily' | 'weekly', targetCount = 1, preferredDays: number[] = []): HabitSchedule => ({ habitId: 'h', effectiveFrom: from, frequency, targetCount, preferredDays });
const checks = (...dates: string[]): HabitCheckin[] => dates.map(d => ({ habitId: 'h', occurrenceDate: d, createdAtMs: 1 }));
const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: id, description: '', category: 'Personal', priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null, createdAtMs: 1, updatedAtMs: 1, completedAtMs: null, firstCompletedAtMs: null, projectId: null, ...over });
const empty = (): PersonalData => ({ goals: [], goalTargets: [], goalEntries: [], habits: [], habitSchedules: [], habitCheckins: [], routines: [], executions: [], rules: [], occurrences: [], priorities: [] });
const noon = (date: string) => new Date(date + 'T12:00:00').getTime();

describe('goal progress', () => {
  it('sums live entries and ignores voided ones, without ever going negative', () => {
    const entries = [entry('a', '2026-10-05', 120), entry('b', '2026-10-20', 80, true), entry('c', '2026-11-01', 60)];
    const s = goalSummary(goal(), [], entries, TODAY);
    expect(s).toMatchObject({ total: 180, target: 300, reached: false });
    expect(s.fraction).toBeCloseTo(0.6);
    expect(goalSummary(goal({ target: 150 }), [], entries, TODAY)).toMatchObject({ reached: true, fraction: 1 });
    expect(goalSummary(goal(), [], [], TODAY).total).toBe(0);
  });
  it('binary goals are complete only when marked complete', () => {
    expect(goalSummary(goal({ kind: 'binary', target: null }), [], [], TODAY).reached).toBe(false);
    expect(goalSummary(goal({ kind: 'binary', target: null, status: 'completed' }), [], [], TODAY).reached).toBe(true);
  });
  const weekly = goal({ kind: 'periodic', period: 'weekly', target: 100, startDate: '2026-10-19' });
  const targets: GoalTarget[] = [{ goalId: 'g', effectiveFrom: '2026-10-19', target: 100 }, { goalId: 'g', effectiveFrom: '2026-11-02', target: 150 }];
  it('measures only the current period and uses the target that applied then', () => {
    const entries = [entry('a', '2026-10-26', 90), entry('b', '2026-11-01', 20), entry('c', '2026-11-02', 40), entry('d', '2026-11-08', 30), entry('e', '2026-11-09', 500)];
    expect(periodProgress(weekly, targets, entries, TODAY)).toEqual({ start: '2026-11-02', end: '2026-11-08', total: 70, target: 150, met: false });
    expect(periodProgress(weekly, targets, entries, '2026-10-28')).toMatchObject({ start: '2026-10-26', total: 110, target: 100, met: true });
    expect(targetAt(weekly, targets, '2026-11-01')).toBe(100); // the raise did not rewrite earlier weeks
  });
  it('keeps earlier periods when a new period starts', () => {
    const entries = [entry('a', '2026-10-20', 100), entry('b', '2026-10-27', 40), entry('c', '2026-11-03', 10)];
    const history = periodHistory(weekly, targets, entries, TODAY);
    expect(history.map(h => [h.start, h.total, h.target, h.met])).toEqual([['2026-10-26', 40, 100, false], ['2026-10-19', 100, 100, true]]);
    expect(periodProgress(weekly, targets, entries, TODAY).total).toBe(10); // the new week starts at zero; history is untouched
  });
  it('supports daily and monthly periods across month and year boundaries', () => {
    const monthly = goal({ kind: 'periodic', period: 'monthly', target: 12, startDate: '2026-11-01' });
    const t: GoalTarget[] = [{ goalId: 'g', effectiveFrom: '2026-11-01', target: 12 }];
    const e = [entry('a', '2026-11-30', 5), entry('b', '2026-12-01', 3), entry('c', '2027-01-01', 9)];
    expect(periodProgress(monthly, t, e, '2026-11-15')).toMatchObject({ start: '2026-11-01', end: '2026-11-30', total: 5 });
    expect(periodProgress(monthly, t, e, '2026-12-31')).toMatchObject({ total: 3 });
    expect(periodProgress(monthly, t, e, '2027-01-02')).toMatchObject({ start: '2027-01-01', total: 9 });
    const daily = goal({ kind: 'periodic', period: 'daily', target: 2, startDate: '2026-11-03' });
    expect(periodProgress(daily, [], [entry('a', '2026-11-03', 1), entry('b', '2026-11-04', 2)], TODAY)).toMatchObject({ total: 2, met: true });
  });
});

describe('habit streaks and consistency', () => {
  it('counts consecutive days, and a pending today does not break the streak', () => {
    const h = habit({ startDate: '2026-10-28' }); const s = [sched('2026-10-26', 'daily')];
    const stats = habitStats(h, s, checks('2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03'), TODAY);
    expect(stats).toMatchObject({ currentStreak: 2, bestStreak: 3, completed: 5, doneToday: false, due: true, unit: 'day' });
    expect(habitStats(h, s, checks('2026-11-02', '2026-11-03', TODAY), TODAY)).toMatchObject({ currentStreak: 3, doneToday: true, due: false });
    expect(habitStats(h, s, checks('2026-11-01', '2026-11-02'), TODAY).currentStreak).toBe(0); // yesterday missed: broken
  });
  it('undoing a check-in updates every figure', () => {
    const h = habit({ startDate: '2026-11-02' }); const s = [sched('2026-11-02', 'daily')];
    expect(habitStats(h, s, checks('2026-11-02', '2026-11-03', TODAY), TODAY)).toMatchObject({ currentStreak: 3, completed: 3 });
    expect(habitStats(h, s, checks('2026-11-02', TODAY), TODAY)).toMatchObject({ currentStreak: 1, bestStreak: 1, completed: 2 });
  });
  it('reports adherence over days since the habit began, never before', () => {
    const h = habit({ startDate: '2026-11-02' });
    expect(habitStats(h, [sched('2026-11-02', 'daily')], checks('2026-11-02', '2026-11-04'), TODAY).adherence).toEqual({ met: 2, of: 3, unit: 'days' });
    expect(habitStats(habit({ startDate: TODAY }), [sched('2026-11-02', 'daily')], [], TODAY).adherence).toBeNull(); // nothing expected yet: no invented rate
  });
  it('weekly habits are met by the weekly target and are not broken by quiet days', () => {
    const h = habit({ startDate: '2026-10-05' }); const s = [sched('2026-10-05', 'weekly', 2, [0, 2])];
    // Weeks of Oct 5, 12, 19 and 26 each have two check-ins; this week (Nov 2) has one so far.
    const c = checks('2026-10-05', '2026-10-09', '2026-10-12', '2026-10-17', '2026-10-19', '2026-10-25', '2026-10-26', '2026-10-30', '2026-11-02');
    const stats = habitStats(h, s, c, TODAY);
    expect(stats).toMatchObject({ unit: 'week', currentStreak: 4, bestStreak: 4, thisWeek: { done: 1, target: 2 }, adherence: { met: 4, of: 4, unit: 'weeks' } });
    expect(stats.due).toBe(true); // short of the target and today is a preferred day
    expect(habitStats(h, s, [...c, ...checks(TODAY)], TODAY)).toMatchObject({ currentStreak: 5, thisWeek: { done: 2 }, due: false });
    expect(habitStats(h, s, checks('2026-10-05', '2026-10-09', '2026-10-26', '2026-10-30'), TODAY).currentStreak).toBe(1); // a missed week breaks it
  });
  it('does not hold a partial first week against a new weekly habit', () => {
    const h = habit({ startDate: '2026-10-08' }); const s = [sched('2026-10-05', 'weekly', 3)];
    const stats = habitStats(h, s, checks('2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-26', '2026-10-27', '2026-10-28', '2026-11-02'), TODAY);
    expect(stats.currentStreak).toBe(3);
    expect(stats.adherence).toEqual({ met: 3, of: 3, unit: 'weeks' }); // the weeks of Oct 12, 19 and 26; the partial first week is neutral
  });
  it('a schedule change keeps history and starts the streak at the switch', () => {
    const h = habit({ startDate: '2026-10-26' });
    const s = [sched('2026-10-26', 'daily'), sched('2026-11-02', 'weekly', 3)];
    const c = checks('2026-10-26', '2026-10-27', '2026-10-28', '2026-11-02', '2026-11-03', TODAY);
    const stats = habitStats(h, s, c, TODAY);
    expect(stats.unit).toBe('week');
    expect(stats.completed).toBe(6); // past check-ins are all still counted
    expect(stats.currentStreak).toBe(1); // the current week met its target; the daily weeks are not mixed in
    expect(describeSchedule(s[1])).toBe('3 times a week');
  });
});

describe('routines, recurrence and priorities', () => {
  const routine = (over: Partial<Routine> = {}): Routine => ({ id: 'r', name: 'Morning', description: '', scheduleDays: [], scheduleTime: null, status: 'active', steps: [], createdAtMs: 1, updatedAtMs: 1, ...over });
  it('offers active routines that are scheduled today or unscheduled', () => {
    const list = [routine({ id: 'a' }), routine({ id: 'b', scheduleDays: [2] }), routine({ id: 'c', scheduleDays: [0] }), routine({ id: 'd', status: 'paused' })];
    expect(routinesForToday(list, TODAY).map(r => r.id)).toEqual(['a', 'b']);
  });
  it('reports partial run progress', () => {
    const run: RoutineExecution = { id: 'x', routineId: 'r', occurrenceDate: TODAY, startedAtMs: 1, completedAtMs: null, steps: [{ position: 0, stepId: 'a', title: 'a', doneAtMs: 5 }, { position: 1, stepId: 'b', title: 'b', doneAtMs: null }] };
    expect(runProgress(run)).toEqual({ done: 1, total: 2 });
  });
  const rule: RecurrenceRule = { id: 'rule', title: 'Rent', description: '', priority: 'normal', frequency: 'monthly', weekdays: [], monthDay: 31, startDate: '2026-01-01', endDate: null, dueTime: null, reminderOffsetMinutes: null, status: 'active', createdAtMs: 1, updatedAtMs: 1 };
  it('describes rules and finds the next open occurrence', () => {
    expect(describeRule(rule)).toBe('Monthly on the 31st (last day of shorter months)');
    expect(describeRule({ ...rule, frequency: 'weekly', weekdays: [1, 3] })).toBe('Every Tue, Thu');
    const occ: Occurrence[] = [{ ruleId: 'rule', occurrenceDate: '2026-11-04', taskId: 't1', status: 'open' }, { ruleId: 'rule', occurrenceDate: '2026-11-30', taskId: 't2', status: 'open' }, { ruleId: 'rule', occurrenceDate: '2026-12-31', taskId: null, status: 'skipped' }];
    expect(nextOccurrence(rule, occ, [task('t1', { completedAtMs: 5 }), task('t2')], TODAY)).toEqual({ date: '2026-11-30', taskId: 't2' }); // today's is done: the next is the next occurrence, not a copy of it
    expect(nextOccurrence(rule, occ, [task('t1', { completedAtMs: 5 }), task('t2', { completedAtMs: 6 })], TODAY)).toBeNull();
  });
  it('orders priorities and carries over only open ones from the last planned day', () => {
    const tasks = [task('a'), task('b', { completedAtMs: 9 }), task('c', { dueDate: '2026-11-20' })];
    const p: DailyPriority[] = [{ planDate: '2026-11-03', taskId: 'a', position: 1 }, { planDate: '2026-11-03', taskId: 'b', position: 0 }, { planDate: '2026-11-03', taskId: 'c', position: 2 }, { planDate: TODAY, taskId: 'c', position: 0 }];
    expect(prioritiesFor('2026-11-03', p, tasks).map(t => t.id)).toEqual(['b', 'a', 'c']);
    expect(carryOver(TODAY, p, tasks).map(t => t.id)).toEqual(['a']); // b is done, c is already planned today
    expect(carryOver(TODAY, [], tasks)).toEqual([]);
  });
});

describe('weekly review', () => {
  it('shows an honest empty state', () => {
    expect(weeklyReview(TODAY, empty(), [], TODAY)).toMatchObject({ start: '2026-11-02', end: '2026-11-08', hasActivity: false, tasksCompleted: 0 });
  });
  it('counts completed work, check-ins, runs and progress, and never scheduled-only work', () => {
    const data = empty();
    data.habits = [habit({ startDate: '2026-10-01' })]; data.habitSchedules = [sched('2026-10-26', 'daily')];
    data.habitCheckins = checks('2026-11-02', '2026-11-03', '2026-10-30');
    data.goals = [goal(), goal({ id: 'done', kind: 'binary', target: null, status: 'completed', completedAtMs: noon('2026-11-03') })];
    data.goalEntries = [entry('a', '2026-11-03', 25), entry('b', '2026-11-04', 10, true), entry('old', '2026-10-30', 99)];
    data.executions = [
      { id: 'x1', routineId: 'r', occurrenceDate: '2026-11-02', startedAtMs: 1, completedAtMs: 9, steps: [] },
      { id: 'x2', routineId: 'r', occurrenceDate: '2026-11-03', startedAtMs: 1, completedAtMs: null, steps: [{ position: 0, stepId: 'a', title: 'a', doneAtMs: 5 }] },
      { id: 'x3', routineId: 'r', occurrenceDate: '2026-11-04', startedAtMs: 1, completedAtMs: null, steps: [{ position: 0, stepId: 'a', title: 'a', doneAtMs: null }] },
    ];
    const tasks = [task('done', { completedAtMs: noon('2026-11-03') }), task('last-week', { completedAtMs: noon('2026-10-30') }), task('planned'), task('overdue', { dueDate: '2026-11-01' }), task('soon', { dueDate: '2026-11-06' }), task('school', { category: 'School', completedAtMs: noon('2026-11-03') })];
    data.priorities = [{ planDate: '2026-11-03', taskId: 'done', position: 0 }, { planDate: '2026-11-04', taskId: 'planned', position: 0 }];
    const r = weeklyReview(TODAY, data, tasks, TODAY);
    expect(r.tasksCompleted).toBe(1); // personal only; last week and School work are not counted
    expect(r.priorities).toEqual({ planned: 2, completed: 1 }); // planned but unfinished is not completed
    expect(r.habits[0]).toMatchObject({ done: 2, expected: 3 });
    expect(r.routines).toEqual({ completed: 1, partial: 1 }); // the untouched run is neither
    expect(r.goals.find(g => g.goal.id === 'g')!.added).toBe(25); // voided and earlier entries excluded
    expect(r.goals.find(g => g.goal.id === 'done')!.completedThisWeek).toBe(true);
    expect(r.outstanding).toEqual({ overdue: 1, dueThisWeek: 1 });
    expect(r.hasActivity).toBe(true);
  });
});
