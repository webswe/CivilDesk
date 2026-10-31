import { localDate } from './scheduling';
import type { StudyBlock, StudyBlockInput, StudyData, StudyGoal, StudySession } from '../services/study';

/**
 * Pure study projections. Planned time (study blocks) and actual time (completed Focus sessions that carry
 * a course) are kept strictly apart: nothing here derives completed minutes from a plan.
 *
 * Convention: dates and times are local wall-clock values (like task deadlines). A week runs Monday to
 * Sunday in the user's local time, matching the Calendar and the challenge board.
 */
export const MS_PER_MINUTE = 60_000;

const parts = (date: string): [number, number, number] => { const [y, m, d] = date.split('-').map(Number); return [y ?? 1970, (m ?? 1) - 1, d ?? 1]; };
/** Monday of the local week containing `date` (a Date or `YYYY-MM-DD`). */
export function weekStartOf(date: Date | string): string {
  const [y, m, d] = typeof date === 'string' ? parts(date) : [date.getFullYear(), date.getMonth(), date.getDate()];
  const day = new Date(y, m, d);
  return localDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7)));
}
export function addWeeks(week: string, n: number): string { const [y, m, d] = parts(week); return localDate(new Date(y, m, d + 7 * n)); }
export function blockStart(b: Pick<StudyBlock, 'startDate' | 'startTime'>): Date {
  const [y, m, d] = parts(b.startDate); const [hh, mm] = b.startTime.split(':').map(Number);
  return new Date(y, m, d, hh ?? 0, mm ?? 0);
}
/** Wall-clock end. A block that crosses midnight ends on the next local date. */
export function blockEnd(b: Pick<StudyBlock, 'startDate' | 'startTime' | 'durationMinutes'>): Date {
  const s = blockStart(b);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes() + b.durationMinutes);
}
export const endDate = (b: StudyBlock): string => localDate(blockEnd(b));
export const hhmm = (d: Date): string => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export function timeRange(b: StudyBlock): string { return b.startTime + '–' + hhmm(blockEnd(b)) + (endDate(b) !== b.startDate ? ' (+1 day)' : ''); }

export type BlockState = 'completed' | 'cancelled' | 'missed' | 'upcoming';
/** `completed` only when a completed Focus session is linked to the block. A past, unstudied block is `missed` and counts for nothing. */
export function blockState(block: StudyBlock, sessions: StudySession[], now: Date): BlockState {
  if (block.status === 'cancelled') return 'cancelled';
  if (sessions.some(s => s.studyBlockId === block.id)) return 'completed';
  return blockEnd(block).getTime() < now.getTime() ? 'missed' : 'upcoming';
}

export const creditedMinutes = (s: StudySession): number => s.creditedMs / MS_PER_MINUTE;
const roundMinutes = (ms: number): number => Math.round(ms / MS_PER_MINUTE);
const finishedOn = (s: StudySession): string => localDate(new Date(s.finishedAtMs));

export interface Totals { minutes: number; sessions: number }
/** Completed study in `[from, to]` (inclusive local dates), optionally for one course. Each session is counted once. */
export function totalsBetween(sessions: StudySession[], from: string, to: string, courseId: string | null = null): Totals {
  const seen = new Set<string>(); let ms = 0;
  for (const s of sessions) {
    if (seen.has(s.id) || (courseId && s.courseId !== courseId)) continue;
    const day = finishedOn(s);
    if (day < from || day > to) continue;
    seen.add(s.id); ms += s.creditedMs;
  }
  return { minutes: roundMinutes(ms), sessions: seen.size };
}
export const weekEnd = (week: string): string => addDays(week, 6);
export const weekTotals = (sessions: StudySession[], week: string, courseId: string | null = null): Totals => totalsBetween(sessions, week, addDays(week, 6), courseId);
function addDays(date: string, n: number): string { const [y, m, d] = parts(date); return localDate(new Date(y, m, d + n)); }

/** The target that applies to `week`: the latest row effective on or before it. Rows with no targets clear the goal. */
export function goalFor(goals: StudyGoal[], courseId: string, week: string): StudyGoal | null {
  const row = goals.filter(g => g.courseId === courseId && g.effectiveWeek <= week).sort((a, b) => b.effectiveWeek.localeCompare(a.effectiveWeek))[0];
  return row && (row.weeklyMinutes !== null || row.weeklySessions !== null) ? row : null;
}
export interface GoalProgress { goal: StudyGoal; totals: Totals; minutesMet: boolean | null; sessionsMet: boolean | null; met: boolean }
export function goalProgress(data: Pick<StudyData, 'goals' | 'sessions'>, courseId: string, week: string): GoalProgress | null {
  const goal = goalFor(data.goals, courseId, week); if (!goal) return null;
  const totals = weekTotals(data.sessions, week, courseId);
  const minutesMet = goal.weeklyMinutes === null ? null : totals.minutes >= goal.weeklyMinutes;
  const sessionsMet = goal.weeklySessions === null ? null : totals.sessions >= goal.weeklySessions;
  return { goal, totals, minutesMet, sessionsMet, met: minutesMet !== false && sessionsMet !== false };
}

export interface PlanSummary { plannedMinutes: number; completedMinutes: number; completedSessions: number; blocks: StudyBlock[] }
/** Study toward one assessment: upcoming planned minutes versus minutes actually studied for it. Cancelled and missed blocks add to neither. */
export function assessmentStudy(taskId: string, data: Pick<StudyData, 'blocks' | 'sessions'>, now: Date): PlanSummary {
  const blocks = data.blocks.filter(b => b.taskId === taskId && b.status === 'planned').sort(byStart);
  const upcoming = blocks.filter(b => blockState(b, data.sessions, now) === 'upcoming');
  const sessions = data.sessions.filter(s => s.taskId === taskId);
  return { plannedMinutes: upcoming.reduce((n, b) => n + b.durationMinutes, 0), completedMinutes: roundMinutes(sessions.reduce((n, s) => n + s.creditedMs, 0)), completedSessions: sessions.length, blocks };
}
export const byStart = (a: StudyBlock, b: StudyBlock): number => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime);
export function upcomingBlocks(data: Pick<StudyData, 'blocks' | 'sessions'>, now: Date, courseId: string | null = null): StudyBlock[] {
  return data.blocks.filter(b => (!courseId || b.courseId === courseId) && blockState(b, data.sessions, now) === 'upcoming').sort(byStart);
}
/** Active (not cancelled) blocks that touch a local date, including blocks that run past midnight into it. */
export function blocksOn(date: string, blocks: StudyBlock[]): StudyBlock[] {
  return blocks.filter(b => b.status === 'planned' && (b.startDate === date || endDate(b) === date)).sort(byStart);
}
export interface DayStudy { today: StudyBlock[]; coming: StudyBlock[] }
/** Study blocks for My Day: today's still-relevant blocks and the next few days. Studied and cancelled blocks are not shown. */
export function agendaStudy(data: Pick<StudyData, 'blocks' | 'sessions'>, now: Date, horizonDays = 7): DayStudy {
  const today = localDate(now); const limit = addDays(today, horizonDays);
  const open = data.blocks.filter(b => b.status === 'planned' && blockState(b, data.sessions, now) !== 'completed').sort(byStart);
  return { today: open.filter(b => b.startDate === today), coming: open.filter(b => b.startDate > today && b.startDate <= limit && blockState(b, data.sessions, now) === 'upcoming') };
}
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return minutes + ' min';
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  return m ? h + ' h ' + m + ' min' : h + ' h';
}

export interface BlockDraft extends StudyBlockInput { isNew: boolean }
export const newBlockDraft = (courseId: string, taskId: string | null = null, now = new Date()): BlockDraft => {
  const start = new Date(now.getTime() + 60 * 60_000); // next full hour
  start.setMinutes(0, 0, 0);
  return { id: crypto.randomUUID(), courseId, taskId, title: '', startDate: localDate(start), startTime: hhmm(start), durationMinutes: 45, isNew: true };
};
export const editBlockDraft = (b: StudyBlock): BlockDraft => ({ id: b.id, courseId: b.courseId, taskId: b.taskId, title: b.title, startDate: b.startDate, startTime: b.startTime, durationMinutes: b.durationMinutes, isNew: false });

