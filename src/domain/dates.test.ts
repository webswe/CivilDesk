import { describe, expect, it } from 'vitest';
import { addDays, daysInMonth, fromDays, isValidDate, monthEnd, monthStart, monthlyDay, periodEnd, periodStart, ruleDates, toDays, weekStart, weekday } from './dates';

describe('civil date arithmetic', () => {
  it('round-trips days and knows the weekday', () => {
    expect(fromDays(0)).toBe('1970-01-01');
    expect(weekday('1970-01-01')).toBe(3); // Thursday
    expect(weekday('2026-11-02')).toBe(0); // Monday
    expect(weekday('2024-02-29')).toBe(3);
    for (const d of [-800000, -1, 0, 19000, 40000]) expect(toDays(fromDays(d))).toBe(d);
  });
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it('weeks run Monday to Sunday and months start on the 1st', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // a Sunday belongs to the week that began on Monday 26 Oct
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(periodStart('weekly', '2026-11-08')).toBe('2026-11-02');
    expect(periodEnd('weekly', '2026-11-08')).toBe('2026-11-08');
    expect(monthStart('2026-11-17')).toBe('2026-11-01');
    expect(monthEnd('2024-02-10')).toBe('2024-02-29');
    expect(periodEnd('monthly', '2026-12-05')).toBe('2026-12-31');
    expect(periodStart('daily', '2026-11-04')).toBe('2026-11-04');
  });
  it('validates dates strictly', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
    expect(isValidDate('2025-13-01')).toBe(false);
    expect(isValidDate('2025-1-01')).toBe(false);
  });
});

describe('recurrence dates', () => {
  it('puts a monthly day 29-31 on the last day of shorter months', () => {
    expect(monthlyDay(2025, 2, 31)).toBe(28);
    expect(monthlyDay(2024, 2, 30)).toBe(29);
    expect(ruleDates('monthly', [], 31, '2026-01-01', null, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(ruleDates('monthly', [], 29, '2024-01-01', null, '2024-02-01', '2024-03-31')).toEqual(['2024-02-29', '2024-03-29']);
    expect(ruleDates('monthly', [], 29, '2025-01-01', null, '2025-02-01', '2025-03-31')).toEqual(['2025-02-28', '2025-03-29']);
  });
  it('handles weekly rules, start and end, and a year boundary', () => {
    expect(ruleDates('weekly', [1], 1, '2026-10-01', null, '2026-10-26', '2026-11-15')).toEqual(['2026-10-27', '2026-11-03', '2026-11-10']);
    expect(ruleDates('daily', [], 1, '2026-10-01', '2026-10-28', '2026-10-26', '2026-11-15')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(ruleDates('daily', [], 1, '2026-11-10', null, '2026-11-01', '2026-11-11')).toEqual(['2026-11-10', '2026-11-11']);
    expect(ruleDates('weekly', [0, 4], 1, '2026-01-01', null, '2026-12-28', '2027-01-04')).toEqual(['2026-12-28', '2027-01-01', '2027-01-04']);
  });
  it('does not skip or repeat a day when the clocks change', () => {
    // US clocks change 2026-11-01 and EU clocks 2026-10-25 / 2026-03-29: civil dates are unaffected.
    expect(ruleDates('daily', [], 1, '2026-10-30', null, '2026-10-30', '2026-11-03')).toHaveLength(5);
    expect(ruleDates('daily', [], 1, '2026-03-27', null, '2026-03-27', '2026-03-31')).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });
});
