import { invoke } from '@tauri-apps/api/core';
import { addDays, horizonDays, isValidDate, isValidTime, periodStart, ruleDates, weekStart, type Frequency, type Period } from '../domain/dates';
import { localDate } from '../domain/scheduling';
import { previewWorkspace, type Task } from './workspace';

export type GoalKind = 'binary' | 'numeric' | 'periodic';
export type GoalStatus = 'active' | 'paused' | 'archived' | 'completed';
export interface Goal {
  id: string; title: string; description: string; kind: GoalKind; target: number | null; unit: string; period: Period | null;
  startDate: string; targetDate: string | null; status: GoalStatus; completedAtMs: number | null; createdAtMs: number; updatedAtMs: number;
}
export type GoalInput = Pick<Goal, 'id' | 'title' | 'description' | 'kind' | 'target' | 'unit' | 'period' | 'startDate' | 'targetDate'>;
/** A periodic target that applies from `effectiveFrom` (the start of a period) until a later row replaces it. */
export interface GoalTarget { goalId: string; effectiveFrom: string; target: number }
/** Progress is a list of entries. A mistake is corrected by voiding the entry, which keeps it as history. */
export interface GoalEntry { id: string; goalId: string; entryDate: string; amount: number; note: string; createdAtMs: number; voidedAtMs: number | null }
export interface GoalEntryInput { id: string; goalId: string; entryDate: string; amount: number; note: string }

export type HabitStatus = 'active' | 'paused' | 'archived';
export interface Habit { id: string; name: string; description: string; status: HabitStatus; startDate: string; createdAtMs: number; updatedAtMs: number }
/** The schedule that applies from `effectiveFrom` (a Monday). Earlier weeks keep the schedule they had. */
export interface HabitSchedule { habitId: string; effectiveFrom: string; frequency: 'daily' | 'weekly'; targetCount: number; preferredDays: number[] }
export interface HabitCheckin { habitId: string; occurrenceDate: string; createdAtMs: number }
export interface HabitInput { id: string; name: string; description: string; frequency: 'daily' | 'weekly'; targetCount: number; preferredDays: number[]; startDate: string | null }

export interface RoutineStep { id: string; title: string }
export interface Routine { id: string; name: string; description: string; scheduleDays: number[]; scheduleTime: string | null; status: HabitStatus; steps: RoutineStep[]; createdAtMs: number; updatedAtMs: number }
export interface ExecutionStep { position: number; stepId: string; title: string; doneAtMs: number | null }
/** One run of a routine on one date. It keeps its own copy of the steps, so later edits never change history. */
export interface RoutineExecution { id: string; routineId: string; occurrenceDate: string; startedAtMs: number; completedAtMs: number | null; steps: ExecutionStep[] }
export type RoutineInput = Pick<Routine, 'id' | 'name' | 'description' | 'scheduleDays' | 'scheduleTime' | 'steps'>;

export type RuleStatus = 'active' | 'paused' | 'ended';
export interface RecurrenceRule {
  id: string; title: string; description: string; priority: 'low' | 'normal' | 'high'; frequency: Frequency; weekdays: number[]; monthDay: number | null;
  startDate: string; endDate: string | null; dueTime: string | null; reminderOffsetMinutes: number | null; status: RuleStatus; createdAtMs: number; updatedAtMs: number;
}
export type RecurrenceInput = Pick<RecurrenceRule, 'id' | 'title' | 'description' | 'priority' | 'frequency' | 'weekdays' | 'monthDay' | 'startDate' | 'endDate' | 'dueTime' | 'reminderOffsetMinutes'>;
/** One date of one rule. `taskId` is an ordinary task; it is null once skipped or removed. */
export interface Occurrence { ruleId: string; occurrenceDate: string; taskId: string | null; status: 'open' | 'skipped' }
export interface DailyPriority { planDate: string; taskId: string; position: number }
export interface PersonalData {
  goals: Goal[]; goalTargets: GoalTarget[]; goalEntries: GoalEntry[]; habits: Habit[]; habitSchedules: HabitSchedule[]; habitCheckins: HabitCheckin[];
  routines: Routine[]; executions: RoutineExecution[]; rules: RecurrenceRule[]; occurrences: Occurrence[]; priorities: DailyPriority[];
}
export const MAX_PRIORITIES = 5;
const MAX_ENTRY = 1_000_000_000;

const native = () => '__TAURI_INTERNALS__' in window;
const emptyPersonal = (): PersonalData => ({ goals: [], goalTargets: [], goalEntries: [], habits: [], habitSchedules: [], habitCheckins: [], routines: [], executions: [], rules: [], occurrences: [], priorities: [] });
const preview: PersonalData = emptyPersonal();
const clone = <T,>(x: T): T => structuredClone(x);
export function resetPersonalPreview(): void { Object.assign(preview, emptyPersonal()); }

const need = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const text = (s: string, what: string, max: number) => { const t = s.trim(); need(t.length > 0 && [...t].length <= max, `${what} must be 1–${max} characters`); return t; };
const cleanDays = (days: number[]) => { need(days.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'Weekdays must be Monday to Sunday'); return [...new Set(days)].sort((a, b) => a - b); };
const requireDate = (s: string, what: string) => need(isValidDate(s), `${what} is not a valid date`);

export async function loadPersonal(): Promise<PersonalData> {
  if (native()) return invoke<PersonalData>('load_personal');
  // Like the native query, an occurrence whose task was deleted reads as removed, and a deleted task leaves the plan.
  const tasks = previewWorkspace().tasks;
  const live = (id: string | null) => !!id && tasks.some(t => t.id === id);
  const data = clone(preview);
  data.occurrences = data.occurrences.map(o => ({ ...o, taskId: live(o.taskId) ? o.taskId : null }));
  data.priorities = data.priorities.filter(p => live(p.taskId));
  return data;
}

// ---------------------------------------------------------------- goals
export async function saveGoal(goal: GoalInput, today = localDate()): Promise<void> {
  if (native()) return invoke('save_goal', { goal, today });
  const title = text(goal.title, 'Title', 200);
  need(goal.description.length <= 5000 && goal.unit.length <= 40, 'Description or unit is too long');
  requireDate(goal.startDate, 'Start date');
  if (goal.targetDate !== null) { requireDate(goal.targetDate, 'Target date'); need(goal.targetDate >= goal.startDate, 'The target date cannot be before the start date'); }
  const validTarget = goal.target !== null && Number.isInteger(goal.target) && goal.target >= 1 && goal.target <= MAX_ENTRY;
  need((goal.kind === 'binary' && goal.target === null && goal.period === null) || (goal.kind === 'numeric' && validTarget && goal.period === null) || (goal.kind === 'periodic' && validTarget && goal.period !== null), 'Check the goal type, target and period');
  const old = preview.goals.find(g => g.id === goal.id); const now = Date.now();
  if (!old) {
    preview.goals.push({ ...goal, title, unit: goal.unit.trim(), status: 'active', completedAtMs: null, createdAtMs: now, updatedAtMs: now });
    if (goal.period && goal.target !== null) preview.goalTargets.push({ goalId: goal.id, effectiveFrom: periodStart(goal.period, goal.startDate), target: goal.target });
    return;
  }
  need(old.status !== 'archived', 'Restore this goal before editing it');
  need(old.kind === goal.kind && old.period === goal.period, "A goal's type and period cannot change; create a new goal instead");
  Object.assign(old, { title, description: goal.description, unit: goal.unit.trim(), target: goal.target, targetDate: goal.targetDate, updatedAtMs: now });
  if (goal.period && goal.target !== null) {
    const from = periodStart(goal.period, today); const row = preview.goalTargets.find(t => t.goalId === goal.id && t.effectiveFrom === from);
    const current = [...preview.goalTargets].filter(t => t.goalId === goal.id && t.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (row) row.target = goal.target; else if (current?.target !== goal.target) preview.goalTargets.push({ goalId: goal.id, effectiveFrom: from, target: goal.target });
  }
}
export async function setGoalStatus(id: string, status: GoalStatus): Promise<void> {
  if (native()) return invoke('set_goal_status', { id, status });
  const g = preview.goals.find(x => x.id === id); need(!!g, 'Goal no longer exists');
  if (!g || g.status === status) return;
  need(!(status === 'completed' && g.kind === 'periodic'), 'A repeating goal has no end state; pause or archive it instead');
  g.completedAtMs = status === 'completed' ? Date.now() : status === 'active' ? null : g.completedAtMs; g.status = status; g.updatedAtMs = Date.now();
}
export async function addGoalEntry(entry: GoalEntryInput, today = localDate()): Promise<void> {
  if (native()) return invoke('add_goal_entry', { entry, today });
  requireDate(entry.entryDate, 'Entry date');
  need(Number.isInteger(entry.amount) && entry.amount >= 1 && entry.amount <= MAX_ENTRY, 'Progress must be a positive whole number');
  need(entry.entryDate <= today, 'Progress cannot be recorded for a future date');
  need(entry.note.length <= 500, 'Note is too long');
  const g = preview.goals.find(x => x.id === entry.goalId); need(!!g, 'Goal no longer exists');
  need(g!.kind !== 'binary', 'A yes/no goal has no numeric progress');
  need(g!.status === 'active', 'Resume this goal before recording progress');
  need(entry.entryDate >= g!.startDate, 'Progress cannot be dated before the goal started');
  if (preview.goalEntries.some(e => e.id === entry.id)) return; // a repeated submit changes nothing
  preview.goalEntries.push({ ...entry, note: entry.note.trim(), createdAtMs: Date.now(), voidedAtMs: null });
}
export async function voidGoalEntry(id: string): Promise<void> {
  if (native()) return invoke('void_goal_entry', { id });
  const e = preview.goalEntries.find(x => x.id === id); need(!!e, 'Progress entry no longer exists');
  if (e && e.voidedAtMs === null) e.voidedAtMs = Date.now();
}

// ---------------------------------------------------------------- habits
export async function saveHabit(habit: HabitInput, today = localDate()): Promise<void> {
  if (native()) return invoke('save_habit', { habit, today });
  const name = text(habit.name, 'Name', 120); need(habit.description.length <= 2000, 'Description is too long');
  need((habit.frequency === 'daily' && habit.targetCount === 1) || (habit.frequency === 'weekly' && habit.targetCount >= 1 && habit.targetCount <= 7), 'Choose daily, or weekly with 1–7 days');
  const days = habit.frequency === 'weekly' ? cleanDays(habit.preferredDays) : [];
  const old = preview.habits.find(h => h.id === habit.id); const now = Date.now();
  if (!old) {
    const start = habit.startDate ?? today; requireDate(start, 'Start date');
    need(start <= today && start >= addDays(today, -365), 'Start date must be within the past year and not in the future');
    preview.habits.push({ id: habit.id, name, description: habit.description, status: 'active', startDate: start, createdAtMs: now, updatedAtMs: now });
    preview.habitSchedules.push({ habitId: habit.id, effectiveFrom: weekStart(start), frequency: habit.frequency, targetCount: habit.targetCount, preferredDays: days });
    return;
  }
  need(old.status !== 'archived', 'Restore this habit before editing it');
  Object.assign(old, { name, description: habit.description, updatedAtMs: now });
  const current = [...preview.habitSchedules].filter(s => s.habitId === habit.id && s.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!current || current.frequency !== habit.frequency || current.targetCount !== habit.targetCount || current.preferredDays.join() !== days.join()) {
    const from = weekStart(today); preview.habitSchedules = preview.habitSchedules.filter(s => !(s.habitId === habit.id && s.effectiveFrom === from));
    preview.habitSchedules.push({ habitId: habit.id, effectiveFrom: from, frequency: habit.frequency, targetCount: habit.targetCount, preferredDays: days });
  }
}
export async function setHabitStatus(id: string, status: HabitStatus): Promise<void> {
  if (native()) return invoke('set_habit_status', { id, status });
  const h = preview.habits.find(x => x.id === id); need(!!h, 'Habit no longer exists');
  if (h && h.status !== status) { h.status = status; h.updatedAtMs = Date.now(); }
}
export async function setHabitCheckin(habitId: string, date: string, done: boolean, today = localDate()): Promise<void> {
  if (native()) return invoke('set_habit_checkin', { habitId, date, done, today });
  requireDate(date, 'Date');
  const h = preview.habits.find(x => x.id === habitId); need(!!h, 'Habit no longer exists');
  if (done) {
    need(h!.status === 'active', 'Resume this habit before checking in');
    need(date <= today, 'A habit cannot be checked in for a future day');
    need(date >= addDays(today, -30), 'Check-ins can be added for the last 30 days');
    need(date >= h!.startDate, 'That day is before the habit started');
    if (!preview.habitCheckins.some(c => c.habitId === habitId && c.occurrenceDate === date)) preview.habitCheckins.push({ habitId, occurrenceDate: date, createdAtMs: Date.now() });
  } else preview.habitCheckins = preview.habitCheckins.filter(c => !(c.habitId === habitId && c.occurrenceDate === date));
}

// ---------------------------------------------------------------- routines
export async function saveRoutine(routine: RoutineInput): Promise<void> {
  if (native()) return invoke('save_routine', { routine });
  const name = text(routine.name, 'Name', 120); need(routine.description.length <= 2000, 'Description is too long');
  const days = cleanDays(routine.scheduleDays);
  need(routine.scheduleTime === null || isValidTime(routine.scheduleTime), 'Invalid time');
  need(routine.scheduleTime === null || days.length > 0, 'Choose the days for a scheduled time');
  need(routine.steps.length >= 1 && routine.steps.length <= 40, 'A routine needs 1–40 steps');
  need(new Set(routine.steps.map(s => s.id)).size === routine.steps.length, 'Duplicate step');
  const steps = routine.steps.map(s => ({ id: s.id, title: text(s.title, 'Step', 200) }));
  const old = preview.routines.find(r => r.id === routine.id); const now = Date.now();
  if (old) { need(old.status !== 'archived', 'Restore this routine before editing it'); Object.assign(old, { name, description: routine.description, scheduleDays: days, scheduleTime: routine.scheduleTime, steps, updatedAtMs: now }); }
  else preview.routines.push({ id: routine.id, name, description: routine.description, scheduleDays: days, scheduleTime: routine.scheduleTime, status: 'active', steps, createdAtMs: now, updatedAtMs: now });
}
export async function setRoutineStatus(id: string, status: HabitStatus): Promise<void> {
  if (native()) return invoke('set_routine_status', { id, status });
  const r = preview.routines.find(x => x.id === id); need(!!r, 'Routine no longer exists');
  if (r && r.status !== status) { r.status = status; r.updatedAtMs = Date.now(); }
}
export async function startRoutine(routineId: string, executionId: string, date: string, today = localDate()): Promise<void> {
  if (native()) return invoke('start_routine', { routineId, executionId, date, today });
  requireDate(date, 'Date'); need(date <= today && date >= addDays(today, -7), 'A routine can be run for today or the last 7 days');
  const r = preview.routines.find(x => x.id === routineId); need(!!r, 'Routine no longer exists');
  if (preview.executions.some(e => e.routineId === routineId && e.occurrenceDate === date)) return; // one run per routine per day
  need(r!.status === 'active', 'Resume this routine before starting it'); need(r!.steps.length > 0, 'This routine has no steps');
  preview.executions.unshift({ id: executionId, routineId, occurrenceDate: date, startedAtMs: Date.now(), completedAtMs: null, steps: r!.steps.map((s, position) => ({ position, stepId: s.id, title: s.title, doneAtMs: null })) });
}
export async function setRoutineStep(executionId: string, position: number, done: boolean): Promise<void> {
  if (native()) return invoke('set_routine_step', { executionId, position, done });
  const e = preview.executions.find(x => x.id === executionId); need(!!e, 'This routine run no longer exists');
  need(e!.completedAtMs === null, 'This routine run is already complete');
  const step = e!.steps.find(s => s.position === position); need(!!step, 'That step is not part of this run');
  step!.doneAtMs = done ? step!.doneAtMs ?? Date.now() : null;
}
export async function completeRoutine(executionId: string): Promise<void> {
  if (native()) return invoke('complete_routine', { executionId });
  const e = preview.executions.find(x => x.id === executionId); need(!!e, 'This routine run no longer exists');
  if (!e || e.completedAtMs !== null) return;
  const open = e.steps.filter(s => s.doneAtMs === null).length; need(open === 0, `${open} step(s) are still unchecked`);
  e.completedAtMs = Date.now();
}

// ---------------------------------------------------------------- recurring responsibilities
function newTask(rule: RecurrenceRule, date: string): Task {
  const now = Date.now();
  return { id: `rec-${rule.id}-${date}`, title: rule.title, description: rule.description, category: 'Personal', priority: rule.priority, dueDate: date, dueTime: rule.dueTime, subtasks: [], reminderOffsetMinutes: rule.reminderOffsetMinutes, createdAtMs: now, updatedAtMs: now, completedAtMs: null, firstCompletedAtMs: null, projectId: null };
}
function generateRule(rule: RecurrenceRule, today: string): void {
  if (rule.status !== 'active') return;
  const ws = previewWorkspace();
  for (const date of ruleDates(rule.frequency, rule.weekdays, rule.monthDay ?? 1, rule.startDate, rule.endDate, today, addDays(today, horizonDays(rule.frequency)))) {
    if (preview.occurrences.some(o => o.ruleId === rule.id && o.occurrenceDate === date)) continue;
    const task = newTask(rule, date);
    ws.tasks = [task, ...ws.tasks.filter(t => t.id !== task.id)];
    preview.occurrences.push({ ruleId: rule.id, occurrenceDate: date, taskId: task.id, status: 'open' });
  }
}
function removeFutureOpen(ruleId: string, today: string): void {
  const ws = previewWorkspace();
  const doomed = preview.occurrences.filter(o => o.ruleId === ruleId && o.status === 'open' && o.occurrenceDate > today && !ws.tasks.find(t => t.id === o.taskId)?.completedAtMs);
  const ids = new Set(doomed.map(o => o.taskId));
  ws.tasks = ws.tasks.filter(t => !ids.has(t.id));
  preview.occurrences = preview.occurrences.filter(o => !doomed.includes(o));
}
export async function saveRecurrence(input: RecurrenceInput, today = localDate()): Promise<void> {
  if (native()) return invoke('save_recurrence', { rule: input, today });
  const title = text(input.title, 'Title', 200);
  need(input.description.length <= 10_000, 'Description is too long');
  need(['low', 'normal', 'high'].includes(input.priority), 'Invalid priority');
  requireDate(input.startDate, 'Start date');
  if (input.endDate !== null) { requireDate(input.endDate, 'End date'); need(input.endDate >= input.startDate, 'The end date cannot be before the start date'); }
  need(input.dueTime === null || isValidTime(input.dueTime), 'Invalid due time');
  const weekdays = input.frequency === 'weekly' ? cleanDays(input.weekdays) : [];
  need(input.frequency !== 'weekly' || weekdays.length > 0, 'Choose at least one weekday');
  need(input.frequency !== 'monthly' || (input.monthDay !== null && input.monthDay >= 1 && input.monthDay <= 31), 'Choose a day of the month from 1 to 31');
  need(['daily', 'weekly', 'monthly'].includes(input.frequency), 'Invalid recurrence');
  const monthDay = input.frequency === 'monthly' ? input.monthDay : null;
  const old = preview.rules.find(r => r.id === input.id); const now = Date.now();
  let changed = true;
  let rule: RecurrenceRule;
  if (old) {
    need(old.status !== 'ended', 'This recurrence has ended');
    changed = old.frequency !== input.frequency || old.weekdays.join() !== weekdays.join() || old.monthDay !== monthDay || old.startDate !== input.startDate || old.endDate !== input.endDate || old.dueTime !== input.dueTime;
    Object.assign(old, { title, description: input.description, priority: input.priority, frequency: input.frequency, weekdays, monthDay, startDate: input.startDate, endDate: input.endDate, dueTime: input.dueTime, reminderOffsetMinutes: input.reminderOffsetMinutes, updatedAtMs: now });
    rule = old;
  } else {
    rule = { ...input, title, weekdays, monthDay, status: 'active', createdAtMs: now, updatedAtMs: now };
    preview.rules.push(rule);
  }
  if (changed) removeFutureOpen(rule.id, today);
  else for (const o of preview.occurrences) { const t = o.status === 'open' && o.occurrenceDate >= today ? previewWorkspace().tasks.find(x => x.id === o.taskId) : undefined; if (t && !t.completedAtMs && o.ruleId === rule.id) Object.assign(t, { title, description: input.description, priority: input.priority, reminderOffsetMinutes: input.reminderOffsetMinutes, updatedAtMs: now }); }
  generateRule(rule, today);
}
export async function setRecurrenceStatus(id: string, status: RuleStatus, today = localDate()): Promise<void> {
  if (native()) return invoke('set_recurrence_status', { id, status, today });
  const r = preview.rules.find(x => x.id === id); need(!!r, 'Recurrence no longer exists');
  if (!r || r.status === status) return;
  need(r.status !== 'ended', 'An ended recurrence cannot be restarted; create a new one');
  r.status = status; r.updatedAtMs = Date.now();
  if (status === 'active') generateRule(r, today); else removeFutureOpen(r.id, today);
}
export async function skipOccurrence(taskId: string): Promise<void> {
  if (native()) return invoke('skip_occurrence', { taskId });
  const ws = previewWorkspace();
  const o = preview.occurrences.find(x => x.taskId === taskId); const t = ws.tasks.find(x => x.id === taskId);
  need(!!o && !!t, 'That task is not a recurring occurrence');
  need(!t!.completedAtMs, 'A completed occurrence cannot be skipped; reopen it first');
  o!.status = 'skipped'; o!.taskId = null; ws.tasks = ws.tasks.filter(x => x.id !== taskId);
}
export async function restoreOccurrence(ruleId: string, date: string, today = localDate()): Promise<void> {
  if (native()) return invoke('restore_occurrence', { ruleId, date, today });
  requireDate(date, 'Date'); need(date >= today, 'A skipped occurrence from a past day stays in the history');
  const before = preview.occurrences.length;
  preview.occurrences = preview.occurrences.filter(o => !(o.ruleId === ruleId && o.occurrenceDate === date && o.status === 'skipped'));
  const rule = preview.rules.find(r => r.id === ruleId);
  if (rule && preview.occurrences.length < before) generateRule(rule, today);
}
export async function generateRecurring(today = localDate()): Promise<void> {
  if (native()) return invoke('generate_recurring', { today });
  for (const rule of preview.rules) generateRule(rule, today);
}

// ---------------------------------------------------------------- daily priorities
export async function setDailyPriorities(date: string, taskIds: string[], today = localDate()): Promise<void> {
  if (native()) return invoke('set_daily_priorities', { date, taskIds, today });
  requireDate(date, 'Date'); need(date >= today && date <= addDays(today, 7), 'Priorities can be planned for today and the next 7 days');
  need(taskIds.length <= MAX_PRIORITIES && new Set(taskIds).size === taskIds.length, `Choose up to ${MAX_PRIORITIES} different priorities`);
  const tasks = previewWorkspace().tasks; const current = preview.priorities.filter(p => p.planDate === date).map(p => p.taskId);
  for (const id of taskIds) { const t = tasks.find(x => x.id === id); need(!!t, 'A chosen task no longer exists'); need(!t!.completedAtMs || current.includes(id), 'A completed task cannot be added as a priority'); }
  preview.priorities = [...preview.priorities.filter(p => p.planDate !== date), ...taskIds.map((taskId, position) => ({ planDate: date, taskId, position }))];
}
