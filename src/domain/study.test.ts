import { describe, expect, it } from 'vitest';
import { addWeeks, agendaStudy, assessmentStudy, blockEnd, blockState, blocksOn, byStart, endDate, formatMinutes, goalFor, goalProgress, timeRange, totalsBetween, upcomingBlocks, weekStartOf, weekTotals } from './study';
import type { StudyBlock, StudyGoal, StudySession } from '../services/study';

const block = (id: string, over: Partial<StudyBlock> = {}): StudyBlock => ({ id, courseId: 'c1', taskId: null, title: '', startDate: '2026-11-04', startTime: '18:30', durationMinutes: 60, status: 'planned', createdAtMs: 1, updatedAtMs: 1, cancelledAtMs: null, ...over });
const at = (date: string, time: string) => new Date(date + 'T' + time + ':00').getTime();
const session = (id: string, over: Partial<StudySession> = {}): StudySession => ({ id, courseId: 'c1', taskId: null, studyBlockId: null, creditedMs: 30 * 60_000, startedAtMs: at('2026-11-04', '10:00'), finishedAtMs: at('2026-11-04', '10:30'), ...over });
const goal = (over: Partial<StudyGoal> = {}): StudyGoal => ({ courseId: 'c1', effectiveWeek: '2026-11-02', weeklyMinutes: 120, weeklySessions: null, ...over });
const now = new Date('2026-11-04T12:00:00');

describe('weeks and time boundaries', () => {
  it('starts weeks on Monday in local time', () => {
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02');
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02'); // Sunday belongs to the week that began on Monday
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf(new Date(2026, 0, 1))).toBe('2025-12-29'); // across a year boundary
    expect(addWeeks('2026-11-02', -1)).toBe('2026-10-26');
  });
  it('lets a block run past midnight into the next local date', () => {
    const b = block('late', { startDate: '2026-11-04', startTime: '23:30', durationMinutes: 90 });
    expect(endDate(b)).toBe('2026-11-05');
    expect(timeRange(b)).toBe('23:30–01:00 (+1 day)');
    expect(blocksOn('2026-11-05', [b]).map(x => x.id)).toEqual(['late']);
    expect(blocksOn('2026-11-04', [b]).map(x => x.id)).toEqual(['late']);
    expect(blocksOn('2026-11-06', [b])).toEqual([]);
  });
  it('keeps wall-clock times across a daylight-saving change', () => {
    // 2026-03-08 is the US spring-forward date; wall-clock arithmetic must not drift by an hour.
    const b = block('dst', { startDate: '2026-03-07', startTime: '22:00', durationMinutes: 8 * 60 });
    expect(blockEnd(b).getDate()).toBe(8);
    expect(blockEnd(b).getMinutes()).toBe(0);
    expect(blockStartLabel(b)).toBe('22:00');
  });
  it('counts a session in the week of the local day it finished', () => {
    const sunday = session('sun', { finishedAtMs: at('2026-11-08', '23:59') });
    const monday = session('mon', { finishedAtMs: at('2026-11-09', '00:01') });
    expect(weekTotals([sunday, monday], '2026-11-02').sessions).toBe(1);
    expect(weekTotals([sunday, monday], '2026-11-09').sessions).toBe(1);
  });
});
const blockStartLabel = (b: StudyBlock) => b.startTime;

describe('block state', () => {
  it('is upcoming, missed, cancelled or completed, and only a linked session completes a block', () => {
    expect(blockState(block('a', { startDate: '2026-11-05' }), [], now)).toBe('upcoming');
    expect(blockState(block('a', { startDate: '2026-11-03' }), [], now)).toBe('missed');
    expect(blockState(block('a', { status: 'cancelled' }), [], now)).toBe('cancelled');
    expect(blockState(block('a', { startDate: '2026-11-03' }), [session('s', { studyBlockId: 'a' })], now)).toBe('completed');
    expect(blockState(block('a'), [session('s', { studyBlockId: 'other' })], now)).toBe('upcoming');
  });
  it('does not complete a block just because its coursework was completed', () => {
    // Study state depends on sessions only; coursework completion never enters the calculation.
    expect(blockState(block('a', { taskId: 'exam', startDate: '2026-11-05' }), [], now)).toBe('upcoming');
  });
});

describe('study totals', () => {
  it('counts completed minutes from session timer time, never from plans', () => {
    const planned = [block('a', { durationMinutes: 480 })];
    expect(planned.length).toBe(1);
    const t = weekTotals([session('s1', { creditedMs: 25 * 60_000 }), session('s2', { creditedMs: 5 * 60_000 })], '2026-11-02');
    expect(t).toEqual({ minutes: 30, sessions: 2 });
  });
  it('never double counts a repeated session row and respects course and period filters', () => {
    const s = session('s1');
    expect(totalsBetween([s, s], '2026-11-01', '2026-11-30')).toEqual({ minutes: 30, sessions: 1 });
    expect(totalsBetween([s, session('s2', { courseId: 'c2' })], '2026-11-01', '2026-11-30', 'c2')).toEqual({ minutes: 30, sessions: 1 });
    expect(totalsBetween([s], '2026-11-05', '2026-11-30').sessions).toBe(0);
  });
  it('formats minutes compactly', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });
});

describe('weekly goals', () => {
  it('applies the latest goal effective on or before a week and keeps history', () => {
    const goals = [goal({ effectiveWeek: '2026-10-26', weeklyMinutes: 60 }), goal({ effectiveWeek: '2026-11-09', weeklyMinutes: 240 })];
    expect(goalFor(goals, 'c1', '2026-10-19')).toBeNull();
    expect(goalFor(goals, 'c1', '2026-11-02')?.weeklyMinutes).toBe(60);
    expect(goalFor(goals, 'c1', '2026-11-09')?.weeklyMinutes).toBe(240);
    expect(goalFor(goals, 'c2', '2026-11-09')).toBeNull();
  });
  it('treats a goal with no targets as removed from that week on', () => {
    const goals = [goal({ effectiveWeek: '2026-10-26' }), goal({ effectiveWeek: '2026-11-09', weeklyMinutes: null })];
    expect(goalFor(goals, 'c1', '2026-11-02')).not.toBeNull();
    expect(goalFor(goals, 'c1', '2026-11-16')).toBeNull();
  });
  it('reports progress from recorded sessions only', () => {
    const sessions = [session('a', { creditedMs: 100 * 60_000 }), session('b', { creditedMs: 20 * 60_000 })];
    const data = { goals: [goal({ weeklySessions: 3 })], sessions };
    const p = goalProgress(data, 'c1', '2026-11-02')!;
    expect(p.totals).toEqual({ minutes: 120, sessions: 2 });
    expect(p.minutesMet).toBe(true);
    expect(p.sessionsMet).toBe(false);
    expect(p.met).toBe(false);
    expect(goalProgress({ goals: [], sessions }, 'c1', '2026-11-02')).toBeNull();
    // Last week's progress is unaffected by this week's sessions.
    expect(goalProgress(data, 'c1', '2026-11-09')?.totals).toEqual({ minutes: 0, sessions: 0 });
    expect(goalProgress(data, 'c1', '2026-10-26')).toBeNull(); // before the goal existed
  });
});

describe('exam preparation and agendas', () => {
  it('separates planned minutes from minutes studied for one assessment', () => {
    const blocks = [block('up', { taskId: 'exam', startDate: '2026-11-06', durationMinutes: 90 }), block('missed', { taskId: 'exam', startDate: '2026-11-01' }), block('gone', { taskId: 'exam', status: 'cancelled', startDate: '2026-11-07' }), block('other', { taskId: 'quiz' })];
    const sessions = [session('s', { taskId: 'exam', creditedMs: 40 * 60_000 }), session('o', { taskId: 'quiz' })];
    const s = assessmentStudy('exam', { blocks, sessions }, now);
    expect(s.plannedMinutes).toBe(90);
    expect(s.completedMinutes).toBe(40);
    expect(s.completedSessions).toBe(1);
    expect(s.blocks.map(b => b.id)).toEqual(['missed', 'up']);
  });
  it('lists upcoming blocks in time order, optionally per course', () => {
    const blocks = [block('b', { startDate: '2026-11-06' }), block('a', { startDate: '2026-11-05', courseId: 'c2' }), block('c', { startDate: '2026-11-05', startTime: '08:00' })];
    expect(upcomingBlocks({ blocks, sessions: [] }, now).map(b => b.id)).toEqual(['c', 'a', 'b']);
    expect(upcomingBlocks({ blocks, sessions: [] }, now, 'c2').map(b => b.id)).toEqual(['a']);
    expect([...blocks].sort(byStart)[0]?.id).toBe('c');
  });
  it('builds My Day study entries without cancelled, studied or far-off blocks', () => {
    const blocks = [
      block('today', { startDate: '2026-11-04', startTime: '18:30' }), block('earlier', { startDate: '2026-11-04', startTime: '08:00' }),
      block('studied', { startDate: '2026-11-04', startTime: '09:00' }), block('cancelled', { startDate: '2026-11-04', status: 'cancelled' }),
      block('soon', { startDate: '2026-11-06' }), block('far', { startDate: '2026-12-25' }), block('yesterday', { startDate: '2026-11-03' }),
    ];
    const d = agendaStudy({ blocks, sessions: [session('s', { studyBlockId: 'studied' })] }, now);
    expect(d.today.map(b => b.id)).toEqual(['earlier', 'today']);
    expect(d.coming.map(b => b.id)).toEqual(['soon']);
  });
});
