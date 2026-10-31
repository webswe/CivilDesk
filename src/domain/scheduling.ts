import type { FocusSession } from '../services/workspace';
export function localDate(d = new Date()): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
export function elapsedMs(session: FocusSession, now: number): number {
  return session.elapsedMs + (session.status === 'running' && session.runStartedAtMs !== null ? Math.max(0, now - session.runStartedAtMs) : 0);
}
export function remainingMs(session: FocusSession, now: number): number {
  return Math.max(0, session.durationMinutes * 60_000 - elapsedMs(session, now));
}
