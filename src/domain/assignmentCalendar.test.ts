import { describe, expect, it } from 'vitest';
import { monthDays, parseSourceDeadline, shiftMonth, weekDays } from './assignmentCalendar';

describe('assignment calendar civil dates', () => {
  it('preserves date-only and naive wall times without timezone conversion', () => {
    expect(parseSourceDeadline('2027-02-28')).toMatchObject({ date: '2027-02-28', time: null, zone: 'date_only' });
    expect(parseSourceDeadline('2027-03-14T02:30:00')).toMatchObject({ date: '2027-03-14', time: '02:30', zone: 'unverified' });
    expect(parseSourceDeadline('2027-11-07T01:30:00')).toMatchObject({ date: '2027-11-07', time: '01:30', zone: 'unverified' });
  });
  it('recognizes an explicit offset and rejects invalid or absent deadlines', () => {
    expect(parseSourceDeadline('2027-11-07T01:30:00-04:00')).toMatchObject({ date: '2027-11-07', zone: 'offset' });
    expect(parseSourceDeadline(null)).toBeNull();
    for (const value of ['2027-02-29', '2027-04-31T13:00:00', '2027-01-01T25:00:00', '2027-01-01T12:00:00+25:00']) expect(parseSourceDeadline(value)).toBeNull();
  });
  it('navigates month and week boundaries without using timezone instants', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2027-01-01', -1)).toBe('2026-12-01');
    expect(monthDays('2027-01-01')[0]).toBe('2026-12-28');
    expect(weekDays('2027-01-01')).toEqual(['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  });
});
