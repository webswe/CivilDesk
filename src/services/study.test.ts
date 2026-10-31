import { beforeEach, describe, expect, it } from 'vitest';
import { loadAcademic, resetAcademicPreview, saveCourse, saveCoursework, saveSemester, setCourseArchived, setSemesterArchived } from './academic';
import { loadStudy, resetStudyPreview, saveStudyBlock, saveStudyGoal, setStudyBlockCancelled, type StudyBlockInput } from './study';
import { focusAction, previewWorkspace, setTaskCompleted } from './workspace';

const block = (id: string, over: Partial<StudyBlockInput> = {}): StudyBlockInput => ({ id, courseId: 'c1', taskId: null, title: 'Review', startDate: '2026-11-05', startTime: '18:30', durationMinutes: 60, ...over });
const exam = { id: 'exam', title: 'Midterm', description: '', category: 'School', priority: 'normal' as const, dueDate: '2026-11-10', dueTime: null, subtasks: [], reminderOffsetMinutes: null };

async function setup() {
  await saveSemester({ id: 's', name: 'Fall', institution: '', startDate: '2026-08-24', endDate: '2026-12-18', makeActive: true });
  await saveCourse({ id: 'c1', semesterId: 's', code: 'CSE 1321', name: 'Programming', instructor: '', description: '', meetingSchedule: '', location: '', color: '' });
  await saveCourse({ id: 'c2', semesterId: 's', code: 'MATH 2', name: 'Calculus', instructor: '', description: '', meetingSchedule: '', location: '', color: '' });
  await saveCoursework({ task: exam, courseId: 'c1', workType: 'exam', referenceNotes: '' });
}
/** Runs a real preview Focus session to completion by moving its clock back, then completes it through the production path. */
async function finishSession(id: string, taskId: string | null, context: { courseId?: string; studyBlockId?: string }) {
  await focusAction('start', id, taskId, 1, 5, context);
  const s = previewWorkspace().sessions.find(x => x.id === id)!;
  s.runStartedAtMs = (s.runStartedAtMs ?? 0) - 61_000;
  await focusAction('complete', id);
}

describe('study preview store (mirrors the native rules)', () => {
  beforeEach(() => { resetAcademicPreview(); resetStudyPreview(); const w = previewWorkspace(); w.tasks = []; w.sessions = []; w.progression.xp = 0; w.progression.history = []; });

  it('schedules, edits, reschedules and softly cancels blocks without touching the exam deadline', async () => {
    await setup();
    await saveStudyBlock(block('b1', { taskId: 'exam' }));
    await saveStudyBlock(block('b1', { taskId: 'exam', startDate: '2026-11-06', durationMinutes: 90 }));
    let data = await loadStudy();
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0]).toMatchObject({ startDate: '2026-11-06', durationMinutes: 90, status: 'planned' });
    expect(previewWorkspace().tasks[0]?.dueDate).toBe('2026-11-10');
    await setStudyBlockCancelled('b1', true);
    data = await loadStudy();
    expect(data.blocks).toHaveLength(1); // history is kept
    expect(data.blocks[0]?.status).toBe('cancelled');
    await expect(saveStudyBlock(block('b1'))).rejects.toThrow(/Restore a cancelled/);
    await setStudyBlockCancelled('b1', false);
    expect((await loadStudy()).blocks[0]?.status).toBe('planned');
  });
  it('rejects invalid times, durations, unknown courses and coursework from another course', async () => {
    await setup();
    await expect(saveStudyBlock(block('x', { startTime: '25:00' }))).rejects.toThrow(/valid date/);
    await expect(saveStudyBlock(block('x', { startDate: '2026-02-30' }))).rejects.toThrow(/valid date/);
    await expect(saveStudyBlock(block('x', { durationMinutes: 2 }))).rejects.toThrow(/5–480/);
    await expect(saveStudyBlock(block('x', { courseId: 'nope' }))).rejects.toThrow(/no longer exists/);
    await expect(saveStudyBlock(block('x', { courseId: 'c2', taskId: 'exam' }))).rejects.toThrow(/belongs to this course/);
  });
  it('refuses new plans for archived courses and semesters but keeps existing blocks', async () => {
    await setup();
    await saveStudyBlock(block('b1'));
    await setCourseArchived('c1', true);
    await expect(saveStudyBlock(block('b2'))).rejects.toThrow(/Restore the archived/);
    await setCourseArchived('c1', false); await setSemesterArchived('s', true);
    await expect(saveStudyBlock(block('b2'))).rejects.toThrow(/Restore the archived/);
    expect((await loadStudy()).blocks.map(b => b.id)).toEqual(['b1']);
  });
  it('records study time from the focus timer, linked to course, task and block', async () => {
    await setup();
    await saveStudyBlock(block('b1', { taskId: 'exam' }));
    await finishSession('s1', 'exam', { courseId: 'c1', studyBlockId: 'b1' });
    const { sessions } = await loadStudy();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ courseId: 'c1', taskId: 'exam', studyBlockId: 'b1' });
    expect(sessions[0]!.creditedMs).toBeGreaterThanOrEqual(60_000);
    expect(sessions[0]!.creditedMs).toBeLessThanOrEqual(60_000); // the 1-minute session, not the 60-minute plan
    await expect(setStudyBlockCancelled('b1', true)).rejects.toThrow(/already studied/);
    await expect(saveStudyBlock(block('b1', { startDate: '2026-11-09' }))).rejects.toThrow(/history/);
  });
  it('derives the course from an academic task and ignores sessions without academic context', async () => {
    await setup();
    await finishSession('from-task', 'exam', {});
    await finishSession('general', null, {});
    const { sessions } = await loadStudy();
    expect(sessions.map(s => s.id)).toEqual(['from-task']);
    expect(sessions[0]?.courseId).toBe('c1');
  });
  it('does not count stopped sessions, repeated completions or coursework completion as study', async () => {
    await setup();
    await focusAction('start', 'stopped', 'exam', 25, 5, { courseId: 'c1' });
    await focusAction('stop', 'stopped');
    await finishSession('done', 'exam', { courseId: 'c1' });
    await focusAction('complete', 'done'); await focusAction('complete', 'done');
    await setTaskCompleted('exam', true);
    const { sessions } = await loadStudy();
    expect(sessions.map(s => s.id)).toEqual(['done']);
  });
  it('validates goals: Monday start, bounds and known course; keeps earlier weeks', async () => {
    await setup();
    await expect(saveStudyGoal({ courseId: 'c1', effectiveWeek: '2026-11-03', weeklyMinutes: 60, weeklySessions: null })).rejects.toThrow(/Monday/);
    await expect(saveStudyGoal({ courseId: 'c1', effectiveWeek: '2026-11-02', weeklyMinutes: 0, weeklySessions: null })).rejects.toThrow(/Weekly goals/);
    await expect(saveStudyGoal({ courseId: 'zzz', effectiveWeek: '2026-11-02', weeklyMinutes: 60, weeklySessions: null })).rejects.toThrow(/no longer exists/);
    await saveStudyGoal({ courseId: 'c1', effectiveWeek: '2026-10-26', weeklyMinutes: 60, weeklySessions: null });
    await saveStudyGoal({ courseId: 'c1', effectiveWeek: '2026-11-02', weeklyMinutes: 120, weeklySessions: 3 });
    await saveStudyGoal({ courseId: 'c1', effectiveWeek: '2026-11-02', weeklyMinutes: 180, weeklySessions: 3 });
    expect((await loadStudy()).goals.map(g => g.weeklyMinutes)).toEqual([60, 180]);
  });
  it('detaches a block from coursework that moves to another course, keeping the block', async () => {
    await setup();
    await saveStudyBlock(block('b1', { taskId: 'exam' }));
    await saveCoursework({ task: exam, courseId: 'c2', workType: 'exam', referenceNotes: '' });
    const data = await loadStudy();
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0]).toMatchObject({ courseId: 'c1', taskId: null });
    expect((await loadAcademic()).work[0]?.courseId).toBe('c2');
  });
});
