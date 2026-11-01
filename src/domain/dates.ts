/**
 * Calendar arithmetic on local `YYYY-MM-DD` strings. Mirrors `src-tauri/src/dates.rs` rule for rule.
 *
 * Dates are civil dates, never instants: they are converted through UTC day numbers, so a daylight-saving
 * change can neither skip nor repeat a day, and nothing here reads the machine clock.
 */
const DAY = 86_400_000;
const parts = (date: string): [number, number, number] => [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
export const toDays = (date: string): number => { const [y, m, d] = parts(date); const t = new Date(0); t.setUTCFullYear(y, m - 1, d); t.setUTCHours(0, 0, 0, 0); return Math.round(t.getTime() / DAY); };
export const fromDays = (days: number): string => { const t = new Date(days * DAY); return String(t.getUTCFullYear()).padStart(4, '0') + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
export const addDays = (date: string, n: number): string => fromDays(toDays(date) + n);
export const isLeap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
export const daysInMonth = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
/** 0 = Monday … 6 = Sunday. */
export const weekday = (date: string): number => (((toDays(date) + 3) % 7) + 7) % 7;
/** The Monday on or before `date`. Weeks run Monday to Sunday, like the Calendar. */
export const weekStart = (date: string): string => addDays(date, -weekday(date));
export const monthStart = (date: string): string => date.slice(0, 8) + '01';
export const monthEnd = (date: string): string => { const [y, m] = parts(date); return fromDays(toDays(date.slice(0, 8) + '01') + daysInMonth(y, m) - 1); };
export const isValidDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && (() => { const [y, m, d] = parts(s); return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); })();
export const isValidTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/**
 * A monthly responsibility on the 29th, 30th or 31st falls on the last day of shorter months
 * (31st → Feb 28/29, Apr 30). It never skips a month and never spills into the next one.
 */
export const monthlyDay = (y: number, m: number, wanted: number): number => Math.min(wanted, daysInMonth(y, m));
export type Period = 'daily' | 'weekly' | 'monthly';
export const periodStart = (period: Period, date: string): string => period === 'weekly' ? weekStart(date) : period === 'monthly' ? monthStart(date) : date;
export const periodEnd = (period: Period, date: string): string => period === 'weekly' ? addDays(weekStart(date), 6) : period === 'monthly' ? monthEnd(date) : date;

export type Frequency = 'daily' | 'weekly' | 'monthly';
/** Dates in `[from, to]` (inclusive) on which a recurrence fires. Weekdays use 0 = Monday. */
export function ruleDates(frequency: Frequency, weekdays: number[], monthDay: number, start: string, end: string | null, from: string, to: string): string[] {
  const first = from > start ? from : start;
  const last = end !== null && end < to ? end : to;
  const out: string[] = [];
  if (first > last) return out;
  for (let day = toDays(first); day <= toDays(last); day++) {
    const date = fromDays(day); const [y, m, d] = parts(date);
    const fires = frequency === 'daily' || (frequency === 'weekly' && weekdays.includes(weekday(date))) || (frequency === 'monthly' && d === monthlyDay(y, m, monthDay));
    if (fires) out.push(date);
  }
  return out;
}
/** How far ahead occurrences are created (days). Bounded so a long absence creates no backlog. Same as Rust. */
export const horizonDays = (frequency: Frequency): number => frequency === 'daily' ? 2 : frequency === 'weekly' ? 14 : 35;
export const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const weekdayLong = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
