import { describe, expect, it } from 'vitest';
import { formatNotionDate, formatNotionInstant, hostOf, isHttps, mergeById } from './format';

describe('Notion date formatting', () => {
  it('formats a date without a time as that calendar day, whatever the time zone', () => {
    expect(formatNotionInstant('2026-03-05', 'en-US')).toBe('Mar 5, 2026');
    expect(formatNotionInstant('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
    expect(formatNotionInstant('2026-12-31', 'en-US')).toBe('Dec 31, 2026');
  });
  it('formats a date-time with its time and never shows the raw ISO text', () => {
    const out = formatNotionInstant('2026-03-05T14:30:00.000+00:00', 'en-US');
    expect(out).toMatch(/Mar [45], 2026/);
    expect(out).toMatch(/\d{1,2}:30/);
    expect(out).not.toContain('T14');
  });
  it('formats ranges and keeps anything it cannot parse exactly as Notion sent it', () => {
    expect(formatNotionDate('2026-03-05 \u2192 2026-03-09', 'en-US')).toBe('Mar 5, 2026 \u2192 Mar 9, 2026');
    expect(formatNotionDate('next week', 'en-US')).toBe('next week');
    expect(formatNotionInstant('2026-13-45', 'en-US')).not.toBe('');
  });
});

describe('Notion helpers', () => {
  it('accepts only https links and shows their host', () => {
    expect(isHttps('https://example.com/a')).toBe(true);
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'file:///c:/x', 'data:text/html,hi', '//example.com', 'https://']) expect(isHttps(bad)).toBe(false);
    expect(hostOf('https://www.example.com/path?q=1')).toBe('example.com');
  });
  it('merges pages without duplicates, keeping order', () => {
    expect(mergeById([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
});
