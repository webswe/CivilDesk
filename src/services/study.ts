import { invoke } from '@tauri-apps/api/core';
import { loadAcademic, previewHooks } from './academic';
import { previewWorkspace } from './workspace';

export type BlockStatus = 'planned' | 'cancelled';
export interface StudyBlock {
  id: string; courseId: string; taskId: string | null; title: string; startDate: string; startTime: string;
  durationMinutes: number; status: BlockStatus; createdAtMs: number; updatedAtMs: number; cancelledAtMs: number | null;
}
export type StudyBlockInput = Pick<StudyBlock, 'id' | 'courseId' | 'taskId' | 'title' | 'startDate' | 'startTime' | 'durationMinutes'>;
/** Applies from `effectiveWeek` (a Monday) until a later row replaces it. Both targets null means no goal. */
export interface StudyGoal { courseId: string; effectiveWeek: string; weeklyMinutes: number | null; weeklySessions: number | null }
/** A completed Focus session that belongs to a course. `creditedMs` is timer time, capped at the session length. */
export interface StudySession { id: string; courseId: string; taskId: string | null; studyBlockId: string | null; creditedMs: number; startedAtMs: number; finishedAtMs: number }
export interface StudyData { blocks: StudyBlock[]; goals: StudyGoal[]; sessions: StudySession[] }

const native = () => '__TAURI_INTERNALS__' in window;
const preview: Pick<StudyData, 'blocks' | 'goals'> = { blocks: [], goals: [] };
const clone = <T,>(x: T): T => structuredClone(x);
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00')) && new Date(s + 'T12:00:00').toISOString().slice(0, 10) === s;
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export async function loadStudy(): Promise<StudyData> {
  if (native()) return invoke<StudyData>('load_study');
  // Browser preview: sessions come from the preview Focus store, like the native query does from focus_sessions.
  const academic = await loadAcademic();
  const sessions: StudySession[] = [];
  for (const s of previewWorkspace().sessions) {
    if (s.status !== 'completed' || !s.finishedAtMs) continue;
    const block = preview.blocks.find(b => b.id === s.studyBlockId);
    const taskId = s.taskId ?? block?.taskId ?? null;
    const courseId = s.courseId ?? block?.courseId ?? academic.work.find(w => w.taskId === taskId)?.courseId ?? null;
    if (courseId) sessions.push({ id: s.id, courseId, taskId, studyBlockId: s.studyBlockId, creditedMs: Math.min(s.elapsedMs, s.durationMinutes * 60_000), startedAtMs: s.startedAtMs, finishedAtMs: s.finishedAtMs });
  }
  sessions.sort((a, b) => b.finishedAtMs - a.finishedAtMs);
  return { ...clone(preview), sessions };
}
export async function saveStudyBlock(block: StudyBlockInput): Promise<void> {
  if (native()) return invoke('save_study_block', { block });
  if (!validDate(block.startDate) || !validTime(block.startTime)) throw new Error('Choose a valid date and start time');
  if (!Number.isInteger(block.durationMinutes) || block.durationMinutes < 5 || block.durationMinutes > 480) throw new Error('A study block must last 5–480 minutes');
  const academic = await loadAcademic();
  const course = academic.courses.find(c => c.id === block.courseId);
  if (!course) throw new Error('Course no longer exists');
  if (course.archived || academic.semesters.find(s => s.id === course.semesterId)?.archived) throw new Error('Restore the archived course or semester before scheduling study time');
  if (block.taskId && academic.work.find(w => w.taskId === block.taskId)?.courseId !== block.courseId) throw new Error('Choose coursework that belongs to this course');
  const old = preview.blocks.find(b => b.id === block.id);
  if (old && old.status !== 'planned') throw new Error('Restore a cancelled study block before changing it');
  if (old && previewWorkspace().sessions.some(s => s.studyBlockId === block.id && s.status === 'completed')) throw new Error('A study block that was already studied is history and cannot be rescheduled');
  const now = Date.now();
  const next: StudyBlock = { ...block, title: block.title.trim(), status: 'planned', createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now, cancelledAtMs: null };
  preview.blocks = [...preview.blocks.filter(b => b.id !== block.id), next];
}
export async function setStudyBlockCancelled(id: string, cancelled: boolean): Promise<void> {
  if (native()) return invoke('set_study_block_cancelled', { id, cancelled });
  const b = preview.blocks.find(x => x.id === id);
  if (!b) throw new Error('Study block no longer exists');
  if (cancelled && previewWorkspace().sessions.some(s => s.studyBlockId === id && s.status === 'completed')) throw new Error('A study block that was already studied cannot be cancelled');
  b.status = cancelled ? 'cancelled' : 'planned'; b.cancelledAtMs = cancelled ? Date.now() : null; b.updatedAtMs = Date.now();
}
export async function saveStudyGoal(goal: StudyGoal): Promise<void> {
  if (native()) return invoke('save_study_goal', { goal });
  if (!validDate(goal.effectiveWeek) || new Date(goal.effectiveWeek + 'T12:00:00').getDay() !== 1) throw new Error('A weekly goal takes effect from a Monday');
  if ((goal.weeklyMinutes !== null && (goal.weeklyMinutes < 1 || goal.weeklyMinutes > 10080)) || (goal.weeklySessions !== null && (goal.weeklySessions < 1 || goal.weeklySessions > 100))) throw new Error('Weekly goals must be 1–10080 minutes or 1–100 sessions');
  if (!(await loadAcademic()).courses.some(c => c.id === goal.courseId)) throw new Error('Course no longer exists');
  preview.goals = [...preview.goals.filter(g => !(g.courseId === goal.courseId && g.effectiveWeek === goal.effectiveWeek)), goal];
}
/** Detaches blocks from coursework that moved courses or was unlinked (the native side does this in the same transaction). */
export function detachStudyBlocks(taskId: string, keepCourseId: string | null): void {
  for (const b of preview.blocks) if (b.taskId === taskId && b.courseId !== keepCourseId) b.taskId = null;
}
previewHooks.coursework = detachStudyBlocks;
export function resetStudyPreview(): void { preview.blocks = []; preview.goals = []; }
