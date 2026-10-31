import { describe, expect, it } from 'vitest';
import { elapsedMs, localDate, remainingMs } from './scheduling';
import type { FocusSession } from '../services/workspace';
const session: FocusSession = {
  id: 'one', taskId: null, status: 'running', durationMinutes: 25, breakMinutes: 5,
  startedAtMs: 1000, runStartedAtMs: 1000, elapsedMs: 60_000, finishedAtMs: null,
};
describe('focus timing and local dates', () => {
  it('derives remaining time from timestamps, not timer ticks', () => {
    expect(elapsedMs(session, 61_000)).toBe(120_000);
    expect(remainingMs(session, 61_000)).toBe(23 * 60_000);
    expect(remainingMs(session, 2_000_000)).toBe(0);
  });
  it('does not count wall time for a paused session', () => {
    expect(elapsedMs({ ...session, status: 'paused', runStartedAtMs: null }, 2_000_000)).toBe(60_000);
  });
  it('formats a local civil date without UTC conversion', () => {
    expect(localDate(new Date(2024, 1, 29, 23, 30))).toBe('2024-02-29');
  });
});
