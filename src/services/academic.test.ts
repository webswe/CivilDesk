import { beforeEach, describe, expect, it } from 'vitest';
import { deleteCourseworkTask, loadAcademic, resetAcademicPreview, saveCourse, saveCoursework, saveSemester, setActiveSemester, setCourseArchived, setSemesterArchived, unlinkCoursework, type CourseInput, type SemesterInput } from './academic';
import { previewWorkspace, saveTask, setTaskCompleted } from './workspace';

const semester = (id: string, over: Partial<SemesterInput> = {}): SemesterInput => ({ id, name: 'Fall 2026', institution: '', startDate: '2026-08-24', endDate: '2026-12-18', makeActive: false, ...over });
const course = (id: string, semesterId: string, code = 'CSE 1321'): CourseInput => ({ id, semesterId, code, name: 'Programming', instructor: '', description: '', meetingSchedule: '', location: '', color: '' });
const task = (id: string, over = {}) => ({ id, title: id, description: '', category: 'Whatever', priority: 'normal' as const, dueDate: '2026-11-03', dueTime: null, subtasks: [], reminderOffsetMinutes: null, ...over });

describe('academic preview store (mirrors the native rules)', () => {
  beforeEach(() => { resetAcademicPreview(); const w = previewWorkspace(); w.tasks = []; w.progression.xp = 0; w.progression.history = []; });

  it('creates semesters without choosing an active one, and switches the active semester', async () => {
    await saveSemester(semester('a')); await saveSemester(semester('b', { name: 'Spring 2027' }));
    expect((await loadAcademic()).semesters.some(s => s.active)).toBe(false);
    await setActiveSemester('a'); await setActiveSemester('b');
    expect((await loadAcademic()).semesters.filter(s => s.active).map(s => s.id)).toEqual(['b']);
    await saveSemester(semester('a', { name: 'Fall 2026 (edited)' }));
    expect((await loadAcademic()).semesters.find(s => s.id === 'b')?.active).toBe(true);
  });
  it('rejects invalid date ranges and duplicate course codes within a semester only', async () => {
    await expect(saveSemester(semester('x', { endDate: '2026-01-01' }))).rejects.toThrow(/cannot end before/);
    await saveSemester(semester('a')); await saveSemester(semester('b'));
    await saveCourse(course('c1', 'a')); await saveCourse(course('c2', 'b'));
    await expect(saveCourse(course('c3', 'a', 'cse 1321'))).rejects.toThrow(/already has a course/);
  });
  it('archives semesters and courses without deleting coursework', async () => {
    await saveSemester(semester('a', { makeActive: true })); await saveCourse(course('c1', 'a'));
    await saveCoursework({ task: task('t1'), courseId: 'c1', workType: 'exam', referenceNotes: '' });
    await setSemesterArchived('a', true); await setCourseArchived('c1', true);
    const data = await loadAcademic();
    expect(data.semesters[0]).toMatchObject({ active: false, archived: true });
    expect(data.courses).toHaveLength(1); expect(data.work).toHaveLength(1); expect(previewWorkspace().tasks).toHaveLength(1);
    await expect(setActiveSemester('a')).rejects.toThrow(/Restore/);
    await expect(saveCoursework({ task: task('t2'), courseId: 'c1', workType: 'quiz', referenceNotes: '' })).rejects.toThrow(/archived course/);
  });
  it('stores coursework as one ordinary task filed under School and moves it between courses', async () => {
    await saveSemester(semester('a')); await saveCourse(course('c1', 'a')); await saveCourse(course('c2', 'a', 'MATH 2'));
    await saveCoursework({ task: task('t1'), courseId: 'c1', workType: 'quiz', referenceNotes: 'notes' });
    await saveCoursework({ task: task('t1', { title: 'Renamed', dueDate: '2026-11-09' }), courseId: 'c2', workType: 'exam', referenceNotes: '' });
    const tasks = previewWorkspace().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Renamed', category: 'School', dueDate: '2026-11-09' });
    expect((await loadAcademic()).work).toEqual([{ taskId: 't1', courseId: 'c2', workType: 'exam', referenceNotes: '' }]);
  });
  it('keeps the category of an existing task when it is assigned to a course', async () => {
    await saveTask(task('legacy', { category: 'Math homework' }));
    await saveSemester(semester('a')); await saveCourse(course('c1', 'a'));
    await saveCoursework({ task: task('legacy', { category: 'School' }), courseId: 'c1', workType: 'assignment', referenceNotes: '' });
    expect(previewWorkspace().tasks[0]?.category).toBe('Math homework');
  });
  it('completes through the shared task system and awards XP once', async () => {
    await saveSemester(semester('a')); await saveCourse(course('c1', 'a'));
    await saveCoursework({ task: task('t1'), courseId: 'c1', workType: 'assignment', referenceNotes: '' });
    await setTaskCompleted('t1', true); await setTaskCompleted('t1', false); await setTaskCompleted('t1', true);
    expect(previewWorkspace().progression.xp).toBe(25);
    expect(previewWorkspace().tasks[0]?.completedAtMs).not.toBeNull();
  });
  it('unlinking or deleting removes only the academic link', async () => {
    await saveSemester(semester('a')); await saveCourse(course('c1', 'a'));
    await saveCoursework({ task: task('t1'), courseId: 'c1', workType: 'assignment', referenceNotes: '' });
    await saveCoursework({ task: task('t2'), courseId: 'c1', workType: 'assignment', referenceNotes: '' });
    await unlinkCoursework('t1'); expect(previewWorkspace().tasks).toHaveLength(2);
    await deleteCourseworkTask('t2');
    const data = await loadAcademic(); expect(data.work).toEqual([]); expect(data.courses).toHaveLength(1);
  });
});
