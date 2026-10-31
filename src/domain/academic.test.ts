import { describe, expect, it } from 'vitest';
import { academicTaskIds, activeSemester, attention, byDeadline, contextLabel, courseworkFor, courseworkItems, coursesIn, deadlineState, itemFor, progress, unassignedSchoolTasks, validateSemesterDates } from './academic';
import { buildAgenda } from './agenda';
import type { AcademicData } from '../services/academic';
import type { Task, WorkspaceData } from '../services/workspace';

const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: id, description: '', category: 'School', priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null, createdAtMs: 1, updatedAtMs: 1, completedAtMs: null, firstCompletedAtMs: null, projectId: null, ...over });
const sem = (id: string, over = {}) => ({ id, name: id, institution: '', startDate: '2026-08-24', endDate: '2026-12-18', active: false, archived: false, createdAtMs: 1, updatedAtMs: 1, ...over });
const course = (id: string, semesterId: string, code: string, over = {}) => ({ id, semesterId, code, name: code + ' name', instructor: '', description: '', meetingSchedule: '', location: '', color: '', archived: false, createdAtMs: 1, updatedAtMs: 1, ...over });
const academic: AcademicData = {
  semesters: [sem('fall', { active: true }), sem('spring')],
  courses: [course('c1', 'fall', 'CSE 1321'), course('c2', 'fall', 'MATH 2'), course('c3', 'spring', 'CSE 1321'), course('old', 'fall', 'ARCH 1', { archived: true })],
  work: [
    { taskId: 'hw', courseId: 'c1', workType: 'assignment', referenceNotes: '' }, { taskId: 'mid', courseId: 'c1', workType: 'exam', referenceNotes: '' },
    { taskId: 'quiz', courseId: 'c2', workType: 'quiz', referenceNotes: '' }, { taskId: 'spring-hw', courseId: 'c3', workType: 'assignment', referenceNotes: '' },
    { taskId: 'ghost', courseId: 'c1', workType: 'general', referenceNotes: '' },
  ],
};
const tasks = [
  task('hw', { dueDate: '2026-11-02', dueTime: '09:00' }), task('mid', { dueDate: '2026-11-10', priority: 'high' }), task('quiz', { dueDate: '2026-10-30' }),
  task('spring-hw', { dueDate: '2027-02-01' }), task('legacy'), task('math', { category: 'Math homework' }), task('errand', { category: 'Personal' }),
];

describe('academic projections', () => {
  it('derives the active semester only from an explicit choice', () => {
    expect(activeSemester(academic)?.id).toBe('fall');
    expect(activeSemester({ ...academic, semesters: [sem('a'), sem('b')] })).toBeNull();
    expect(activeSemester({ ...academic, semesters: [sem('a', { active: true, archived: true })] })).toBeNull();
  });
  it('keeps same-code courses in different semesters apart', () => {
    expect(coursesIn(academic, 'fall').map(c => c.id)).toEqual(['c1', 'c2']);
    expect(coursesIn(academic, 'spring').map(c => c.id)).toEqual(['c3']);
    expect(coursesIn(academic, 'fall', true)).toHaveLength(3);
    const items = courseworkItems(tasks, academic);
    expect(courseworkFor(items, 'c1').map(i => i.task.id)).toEqual(['hw', 'mid']);
    expect(courseworkFor(items, 'c3').map(i => i.task.id)).toEqual(['spring-hw']);
  });
  it('ignores links whose task is gone and reports School tasks without a course as unassigned', () => {
    expect(courseworkItems(tasks, academic).map(i => i.task.id)).not.toContain('ghost');
    expect(academicTaskIds(tasks, academic).has('hw')).toBe(true);
    expect(unassignedSchoolTasks(tasks, academic).map(t => t.id).sort()).toEqual(['legacy', 'math']);
  });
  it('orders deadlines with undated work last and never calls undated work overdue', () => {
    const list = [task('none'), task('late', { dueDate: '2026-11-05' }), task('early', { dueDate: '2026-11-01', priority: 'low' }), task('early-hi', { dueDate: '2026-11-01', priority: 'high' }), task('timed', { dueDate: '2026-11-01', dueTime: '08:00', priority: 'low' })];
    expect(list.sort(byDeadline).map(t => t.id)).toEqual(['early-hi', 'early', 'timed', 'late', 'none']);
    expect(deadlineState(task('x'), '2026-11-01')).toBe('undated');
    expect(deadlineState(task('x', { dueDate: '2026-10-31' }), '2026-11-01')).toBe('overdue');
    expect(deadlineState(task('x', { dueDate: '2026-11-01' }), '2026-11-01')).toBe('today');
    expect(deadlineState(task('x', { dueDate: '2026-10-01', completedAtMs: 5 }), '2026-11-01')).toBe('completed');
  });
  it('groups attention items once each and drops completed or undated work', () => {
    const withUndated = { ...academic, work: [...academic.work, { taskId: 'undated-c', courseId: 'c1', workType: 'general' as const, referenceNotes: '' }] };
    const items = courseworkItems([...tasks, task('undated-c')], withUndated).filter(i => i.course.semesterId === 'fall');
    const a = attention(items, '2026-11-02', '2026-11-16');
    expect(a.overdue.map(i => i.task.id)).toEqual(['quiz']);
    expect(a.today.map(i => i.task.id)).toEqual(['hw']);
    expect(a.upcoming.map(i => i.task.id)).toEqual(['mid']);
    const done = attention(courseworkItems(tasks.map(t => t.id === 'quiz' ? { ...t, completedAtMs: 9 } : t), academic), '2026-11-02', '2026-11-16');
    expect(done.overdue).toEqual([]);
  });
  it('summarises progress and labels items for other views', () => {
    const items = courseworkItems(tasks.map(t => t.id === 'hw' ? { ...t, completedAtMs: 4 } : t), academic);
    expect(progress(items.filter(i => i.course.id === 'c1'))).toEqual({ done: 1, total: 2 });
    expect(contextLabel(itemFor(items, 'mid'))).toBe('Exam · CSE 1321');
    expect(contextLabel(itemFor(items, 'hw'))).toBe('Assignment · CSE 1321');
    expect(contextLabel(undefined)).toBe('');
  });
  it('validates semester dates', () => {
    expect(validateSemesterDates('2026-08-01', '2026-07-01')).toMatch(/cannot end before/);
    expect(validateSemesterDates('', '2026-07-01')).toMatch(/both/);
    expect(validateSemesterDates('2026-08-01', '2026-08-01')).toBe('');
  });
  it('feeds the existing My Day agenda from the same task list without extra entries', () => {
    const data = { tasks, sessions: [], events: [] } as unknown as WorkspaceData;
    const agenda = buildAgenda(data, { milestones: [] } as never, { progress: [], challenges: [] } as never, new Date('2026-11-02T10:00:00'), 10);
    expect(agenda.todayTasks.map(t => t.id)).toEqual(['hw']);
    expect(agenda.overdue.map(t => t.id)).toEqual(['quiz']);
    expect(agenda.upcoming.map(u => u.taskId)).toEqual(['mid']);
  });
});
