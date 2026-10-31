import { taskArea } from './areas';
import type { AcademicData, Course, CourseworkLink, Semester, WorkType } from '../services/academic';
import { workTypeLabels } from '../services/academic';
import type { Task } from '../services/workspace';

/**
 * Pure academic projections. Coursework is an ordinary task plus a link to a course, so every view
 * (School, My Day, Calendar, Focus) derives its answer from the same task list and these helpers.
 */
export interface CourseworkItem { task: Task; link: CourseworkLink; course: Course }
export type DeadlineState = 'completed' | 'overdue' | 'today' | 'upcoming' | 'undated';

const rank = { high: 0, normal: 1, low: 2 } as const;
/** Dated work first (earliest, then time, then priority); undated work last. */
export function byDeadline(a: Task, b: Task): number {
  if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1;
  return (a.dueDate || '').localeCompare(b.dueDate || '') || (a.dueTime || '').localeCompare(b.dueTime || '') || rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title);
}
export function deadlineState(task: Task, today: string): DeadlineState {
  if (task.completedAtMs) return 'completed';
  if (!task.dueDate) return 'undated';
  return task.dueDate < today ? 'overdue' : task.dueDate === today ? 'today' : 'upcoming';
}

export function activeSemester(data: AcademicData): Semester | null { return data.semesters.find(s => s.active && !s.archived) ?? null; }
export function coursesIn(data: AcademicData, semesterId: string, includeArchived = false): Course[] {
  return data.courses.filter(c => c.semesterId === semesterId && (includeArchived || !c.archived)).sort((a, b) => a.code.localeCompare(b.code));
}
/** Links whose task or course is gone are ignored, so a stale link can never create a ghost entry. */
export function courseworkItems(tasks: Task[], data: AcademicData): CourseworkItem[] {
  const courses = new Map(data.courses.map(c => [c.id, c]));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const items: CourseworkItem[] = [];
  for (const link of data.work) {
    const task = byId.get(link.taskId); const course = courses.get(link.courseId);
    if (task && course) items.push({ task, link, course });
  }
  return items;
}
export function courseworkFor(items: CourseworkItem[], courseId: string): CourseworkItem[] {
  return items.filter(i => i.course.id === courseId).sort((a, b) => byDeadline(a.task, b.task));
}
export function academicTaskIds(tasks: Task[], data: AcademicData): Set<string> { return new Set(courseworkItems(tasks, data).map(i => i.task.id)); }
export function itemFor(items: CourseworkItem[], taskId: string): CourseworkItem | undefined { return items.find(i => i.task.id === taskId); }

/** School-area tasks that are not linked to any course, such as work created before courses existed. */
export function unassignedSchoolTasks(tasks: Task[], data: AcademicData): Task[] {
  const linked = academicTaskIds(tasks, data);
  return tasks.filter(t => !linked.has(t.id) && taskArea(t.category, Boolean(t.projectId)) === 'school');
}

export interface Attention { overdue: CourseworkItem[]; today: CourseworkItem[]; upcoming: CourseworkItem[] }
/** Open coursework that needs a decision soon. Each item appears in exactly one group. */
export function attention(items: CourseworkItem[], today: string, horizon: string): Attention {
  const open = items.filter(i => !i.task.completedAtMs && i.task.dueDate).sort((a, b) => byDeadline(a.task, b.task));
  return {
    overdue: open.filter(i => i.task.dueDate! < today),
    today: open.filter(i => i.task.dueDate === today),
    upcoming: open.filter(i => i.task.dueDate! > today && i.task.dueDate! <= horizon),
  };
}
export function progress(items: CourseworkItem[]): { done: number; total: number } {
  return { done: items.filter(i => i.task.completedAtMs).length, total: items.length };
}
export function countsByType(items: CourseworkItem[]): Record<WorkType, number> {
  const counts: Record<WorkType, number> = { assignment: 0, quiz: 0, exam: 0, general: 0 };
  for (const i of items) counts[i.link.workType] += 1;
  return counts;
}
/** Subtle context label, e.g. "Exam · CSE 1321". Plain coursework is labelled by course only. */
export function contextLabel(item: CourseworkItem | undefined): string {
  if (!item) return '';
  return (item.link.workType === 'general' ? '' : workTypeLabels[item.link.workType] + ' · ') + item.course.code;
}
export function validateSemesterDates(start: string, end: string): string {
  if (!start || !end) return 'Choose both a start and an end date.';
  return end < start ? 'The semester cannot end before it starts.' : '';
}
