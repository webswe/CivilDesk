import { addDays, isValidDate, isValidTime, monthStart, toDays, weekStart } from './dates';
import { courseworkItems } from './academic';
import type { AcademicData } from '../services/academic';
import type { WorkspaceData } from '../services/workspace';
import type { AssignmentSnapshot } from '../services/brightspace';

export interface Deadline { date: string; time: string | null; zone: 'local' | 'unverified' | 'offset' | 'date_only'; raw: string }
export interface CalendarAssignment { key: string; source: 'local' | 'synthetic'; courseKey: string; courseName: string; courseCode: string; title: string; deadline: Deadline | null; status: string | null; description: string | null; taskId: string | null }
export const sourceCourseKey = (portal: string, courseId: string) => `synthetic:${portal}\u0000${courseId}`;
export const localCourseKey = (courseId: string) => `local:${courseId}`;

/** Provider wall time is never interpreted as a UTC or machine-local instant. */
export function parseSourceDeadline(raw: string | null): Deadline | null {
  if (!raw) return null;
  if (isValidDate(raw)) return { date: raw, time: null, zone: 'date_only', raw };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
  if (!match || !isValidDate(match[1]!) || !isValidTime(`${match[2]}:${match[3]}`) || Number(match[4]) > 59) return null;
  const offset = match[5];
  if (offset && offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;
  return { date: match[1]!, time: `${match[2]}:${match[3]}`, zone: offset ? 'offset' : 'unverified', raw };
}

export function calendarAssignments(data: WorkspaceData, academic: AcademicData, snapshot: AssignmentSnapshot | null): CalendarAssignment[] {
  const local = courseworkItems(data.tasks, academic).filter(item => item.link.workType === 'assignment').map(item => ({
    key: `local:${item.task.id}`, source: 'local' as const, courseKey: localCourseKey(item.course.id),
    courseName: item.course.name, courseCode: item.course.code, title: item.task.title,
    deadline: item.task.dueDate && isValidDate(item.task.dueDate) ? { date: item.task.dueDate, time: item.task.dueTime, zone: item.task.dueTime ? 'local' as const : 'date_only' as const, raw: item.task.dueDate } : null,
    status: item.task.completedAtMs ? 'Completed in CivilDesk' : 'Open in CivilDesk', description: item.task.description || null, taskId: item.task.id,
  }));
  if (!snapshot) return local;
  const courses = new Map(snapshot.courses.map(c => [c.id, c]));
  const synthetic = snapshot.results.flatMap(result => result.assignments.map(a => {
    const course = courses.get(result.courseId);
    if (!course) return null;
    return { key: `synthetic:${snapshot.portalOrigin}\u0000${a.course_id}\u0000${a.id}`, source: 'synthetic' as const,
      courseKey: sourceCourseKey(snapshot.portalOrigin, a.course_id), courseName: course.name, courseCode: course.code,
      title: a.name, deadline: parseSourceDeadline(a.due_date), status: a.submission_status, description: null, taskId: null };
  }).filter((item): item is NonNullable<typeof item> => item !== null));
  return [...local, ...synthetic];
}

export function monthDays(cursor: string): string[] {
  const first = weekStart(monthStart(cursor));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}
export function weekDays(cursor: string): string[] { const first = weekStart(cursor); return Array.from({ length: 7 }, (_, index) => addDays(first, index)); }
export function shiftMonth(cursor: string, direction: number): string {
  const [year, month] = cursor.split('-').map(Number);
  const n = year! * 12 + month! - 1 + direction;
  return `${Math.floor(n / 12)}-${String((n % 12 + 12) % 12 + 1).padStart(2, '0')}-01`;
}
export function compareAssignments(a: CalendarAssignment, b: CalendarAssignment): number {
  return (a.deadline?.date ?? '9999').localeCompare(b.deadline?.date ?? '9999') || (a.deadline?.time ?? '').localeCompare(b.deadline?.time ?? '') || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}
export function upcomingAssignments(items: CalendarAssignment[], today: string, limit = 30): CalendarAssignment[] {
  return items.filter(i => i.deadline && toDays(i.deadline.date) >= toDays(today)).sort(compareAssignments).slice(0, limit);
}
