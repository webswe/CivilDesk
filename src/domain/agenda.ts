import { localDate } from './scheduling';
import type { CalendarEvent } from '../services/calendar';
import type { Task, WorkspaceData } from '../services/workspace';
import type { ChallengeData } from '../services/challenges';
import { activeChallengeDeadlines } from '../services/challenges';
import type { ProjectsData } from '../services/projects';

export function addDays(date: Date, n: number): Date { const next = new Date(date.getFullYear(), date.getMonth(), date.getDate()); next.setDate(next.getDate() + n); return next; }
function localTime(date: Date): string { return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); }
export function localRange(event: CalendarEvent) {
  if (event.allDay || event.startAtMs === null || event.endAtMs === null) return { startDate: event.startDate, startTime: event.startTime, endDate: event.endDate, endTime: event.endTime };
  const start = new Date(event.startAtMs); const end = new Date(event.endAtMs);
  return { startDate: localDate(start), startTime: localTime(start), endDate: localDate(end), endTime: localTime(end) };
}

export interface AgendaItem { key: string; kind: 'event' | 'task' | 'challenge' | 'milestone'; title: string; date: string; time: string | null; note: string; taskId?: string }
export interface Agenda {
  today: string;
  schedule: AgendaItem[];      // events happening today, all-day first then by time
  todayTasks: Task[];          // open tasks due today
  overdue: Task[];             // open tasks past due
  upcoming: AgendaItem[];      // next days: tasks, events, and only-if-dated challenge/milestone commitments
  next: Task | null;           // suggested task to focus on
  doneToday: number;
  focusMinutesToday: number;
  activeChallenge: { id: string; title: string; checks: number; total: number } | null;
}
const rank = { high: 0, normal: 1, low: 2 } as const;
const byDue = (a: Task, b: Task) => (a.dueDate || '').localeCompare(b.dueDate || '') || (a.dueTime || '').localeCompare(b.dueTime || '') || rank[a.priority] - rank[b.priority];

export function buildAgenda(data: WorkspaceData, projects: ProjectsData, challenges: ChallengeData, now = new Date(), horizonDays = 7): Agenda {
  const today = localDate(now);
  const limit = localDate(addDays(now, horizonDays));
  const open = data.tasks.filter(t => !t.completedAtMs);
  const todayTasks = open.filter(t => t.dueDate === today).sort(byDue);
  const overdue = open.filter(t => t.dueDate && t.dueDate < today).sort(byDue);
  const schedule: AgendaItem[] = data.events.flatMap(e => {
    const r = localRange(e);
    if (r.startDate > today || r.endDate < today) return [];
    return [{ key: 'e' + e.id, kind: 'event' as const, title: e.title, date: today, time: e.allDay ? null : r.startTime, note: e.allDay ? 'All day' : (r.startTime || '') + (r.endTime ? '–' + r.endTime : '') }];
  }).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const upcoming: AgendaItem[] = [];
  for (const t of open) if (t.dueDate && t.dueDate > today && t.dueDate <= limit) upcoming.push({ key: 't' + t.id, kind: 'task', title: t.title, date: t.dueDate, time: t.dueTime, note: t.dueTime ? 'Due ' + t.dueTime : 'Due', taskId: t.id });
  for (const e of data.events) { const r = localRange(e); if (r.startDate > today && r.startDate <= limit) upcoming.push({ key: 'e' + e.id, kind: 'event', title: e.title, date: r.startDate, time: e.allDay ? null : r.startTime, note: e.allDay ? 'All day' : r.startTime || '' }); }
  // Engineering commitments appear only when the user set a date for them.
  for (const {progress,challenge} of activeChallengeDeadlines(challenges)) if (progress.deadlineDate && progress.deadlineDate >= today && progress.deadlineDate <= limit) upcoming.push({ key: 'c' + progress.challengeId, kind: 'challenge', title: challenge?.title || progress.challengeId, date: progress.deadlineDate, time: null, note: 'Challenge deadline' });
  for (const m of projects.milestones) if (!m.completedAtMs && m.targetDate > today && m.targetDate <= limit) upcoming.push({ key: 'm' + m.id, kind: 'milestone', title: m.title, date: m.targetDate, time: null, note: 'Project milestone' });
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  const next = [...overdue, ...todayTasks].sort((a, b) => rank[a.priority] - rank[b.priority] || byDue(a, b))[0] ?? open.filter(t => t.dueDate).sort(byDue)[0] ?? open[0] ?? null;
  const doneToday = data.tasks.filter(t => t.completedAtMs && localDate(new Date(t.completedAtMs)) === today).length;
  const focusMinutesToday = data.sessions.filter(s => s.status === 'completed' && s.finishedAtMs && localDate(new Date(s.finishedAtMs)) === today).reduce((n, s) => n + s.durationMinutes, 0);
  const active = challenges.progress.find(p => p.status === 'In Progress');
  const def = active && challenges.challenges.find(c => c.id === active.challengeId);
  return { today, schedule, todayTasks, overdue, upcoming, next, doneToday, focusMinutesToday, activeChallenge: active && def ? { id: def.id, title: def.title, checks: active.checks.length, total: def.checklist.length } : null };
}
