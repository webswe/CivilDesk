import { describe, expect, it } from 'vitest';
import { taskArea } from './areas';
import { formatDue, relativeDay } from './format';

describe('task areas', () => {
  it('maps the three area labels exactly', () => {
    expect(taskArea('School')).toBe('school');
    expect(taskArea('Personal')).toBe('personal');
    expect(taskArea('Engineering')).toBe('engineering');
  });
  it('treats an empty category as personal, matching the previous default label', () => {
    expect(taskArea('')).toBe('personal');
  });
  it('classifies older free-text categories without changing stored data', () => {
    expect(taskArea('Math homework')).toBe('school');
    expect(taskArea('Revit model')).toBe('engineering');
    expect(taskArea('Errands')).toBe('personal');
  });
  it('moves tasks linked to an engineering project into engineering unless the user chose School', () => {
    expect(taskArea('', true)).toBe('engineering');
    expect(taskArea('Errands', true)).toBe('engineering');
    expect(taskArea('School', true)).toBe('school');
  });
});

describe('relative dates', () => {
  const now = new Date(2026, 9, 31, 9, 0);
  it('names today, tomorrow and yesterday', () => {
    expect(relativeDay('2026-10-31', now)).toBe('Today');
    expect(relativeDay('2026-11-01', now)).toBe('Tomorrow');
    expect(relativeDay('2026-10-30', now)).toBe('Yesterday');
  });
  it('flags overdue items and appends the time', () => {
    expect(formatDue('2026-10-29', null, now)).toEqual({ text: 'Overdue · ' + relativeDay('2026-10-29', now), overdue: true });
    expect(formatDue('2026-10-31', '14:30', now)).toEqual({ text: 'Today at 14:30', overdue: false });
  });
});
