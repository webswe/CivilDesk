/** Readable presentation of Notion values. Nothing here changes the value Notion returned; it only formats it for display. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_FMT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
const DATETIME_FMT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

/** One date or date-time. A date with no time is never shifted by the time zone: 2026-03-05 is always 5 March. */
export function formatNotionInstant(raw: string, locale?: string): string {
  const only = DATE_ONLY.exec(raw);
  if (only) {
    const d = new Date(Number(only[1]), Number(only[2]) - 1, Number(only[3]));
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString(locale, DATE_FMT);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString(locale, DATETIME_FMT);
}

/** A Notion date property value: `start`, or `start → end`. Unparseable parts are kept as Notion sent them. */
export function formatNotionDate(text: string, locale?: string): string {
  const parts = text.split(' → ');
  return parts.map(p => formatNotionInstant(p.trim(), locale)).join(' → ');
}

export const propertyKindLabel = (kind: string) => kind.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
export const DATE_KINDS = new Set(['date', 'created_time', 'last_edited_time']);
export const isHttps = (s: string) => /^https:\/\/[^\s/]+/i.test(s);
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export const mergeById = <T extends { id: string }>(a: T[], b: T[]) => { const seen = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => !seen.has(x.id))]; };
