import { localDate } from './scheduling';
import { addDays } from './agenda';

const parse = (date: string) => new Date(date + 'T12:00:00');
/** Friendly relative day: Today, Tomorrow, a weekday within the week, otherwise a short date. */
export function relativeDay(date: string, now = new Date()): string {
  const today = localDate(now);
  if (date === today) return 'Today';
  if (date === localDate(addDays(now, 1))) return 'Tomorrow';
  if (date === localDate(addDays(now, -1))) return 'Yesterday';
  const diff = Math.round((parse(date).getTime() - parse(today).getTime()) / 86_400_000);
  if (diff > 1 && diff < 7) return parse(date).toLocaleDateString(undefined, { weekday: 'long' });
  return parse(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function formatDue(date: string, time: string | null, now = new Date()): { text: string; overdue: boolean } {
  const overdue = date < localDate(now);
  return { text: (overdue ? 'Overdue · ' : '') + relativeDay(date, now) + (time ? ' at ' + time : ''), overdue };
}
