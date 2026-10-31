import { invoke } from '@tauri-apps/api/core';
import { deleteTask, previewWorkspace, saveTask, type TaskInput } from './workspace';

export type WorkType = 'assignment' | 'quiz' | 'exam' | 'general';
export const workTypeLabels: Record<WorkType, string> = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam', general: 'Coursework' };
export const workTypeOrder: WorkType[] = ['assignment', 'quiz', 'exam', 'general'];

export interface Semester {
  id: string; name: string; institution: string; startDate: string; endDate: string;
  active: boolean; archived: boolean; createdAtMs: number; updatedAtMs: number;
}
export interface SemesterInput { id: string; name: string; institution: string; startDate: string; endDate: string; makeActive: boolean }
export interface Course {
  id: string; semesterId: string; code: string; name: string; instructor: string; description: string;
  meetingSchedule: string; location: string; color: string; archived: boolean; createdAtMs: number; updatedAtMs: number;
}
export type CourseInput = Pick<Course, 'id' | 'semesterId' | 'code' | 'name' | 'instructor' | 'description' | 'meetingSchedule' | 'location' | 'color'>;
/** Academic metadata for an ordinary task. The task itself stays the only record of completion and deadline. */
export interface CourseworkLink { taskId: string; courseId: string; workType: WorkType; referenceNotes: string }
export interface CourseworkInput { task: TaskInput; courseId: string; workType: WorkType; referenceNotes: string }
export interface AcademicData { semesters: Semester[]; courses: Course[]; work: CourseworkLink[] }

const native = () => '__TAURI_INTERNALS__' in window;
const preview: AcademicData = { semesters: [], courses: [], work: [] };
const clone = <T,>(x: T): T => structuredClone(x);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00')) && new Date(s + 'T12:00:00').toISOString().slice(0, 10) === s;

export const loadAcademic = async (): Promise<AcademicData> => native() ? invoke<AcademicData>('load_academic') : clone(preview);

export async function saveSemester(semester: SemesterInput): Promise<void> {
  if (native()) return invoke('save_semester', { semester });
  if (!semester.name.trim() || semester.name.length > 80) throw new Error('Semester name must be 1–80 characters');
  if (!isDate(semester.startDate) || !isDate(semester.endDate)) throw new Error('Choose a valid start and end date');
  if (semester.endDate < semester.startDate) throw new Error('The semester cannot end before it starts');
  const old = preview.semesters.find(s => s.id === semester.id);
  if (semester.makeActive && old?.archived) throw new Error('Restore an archived semester before making it active');
  const now = Date.now();
  const next: Semester = { id: semester.id, name: semester.name.trim(), institution: semester.institution.trim(), startDate: semester.startDate, endDate: semester.endDate, active: old?.active ?? false, archived: old?.archived ?? false, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now };
  preview.semesters = [next, ...preview.semesters.filter(s => s.id !== semester.id)];
  if (semester.makeActive) await setActiveSemester(semester.id);
}
export async function setActiveSemester(id: string | null): Promise<void> {
  if (native()) return invoke('set_active_semester', { id });
  const target = preview.semesters.find(s => s.id === id);
  if (id && !target) throw new Error('Semester no longer exists');
  if (target?.archived) throw new Error('Restore an archived semester before making it active');
  for (const s of preview.semesters) s.active = s.id === id;
}
export async function setSemesterArchived(id: string, archived: boolean): Promise<void> {
  if (native()) return invoke('set_semester_archived', { id, archived });
  const s = preview.semesters.find(x => x.id === id);
  if (!s) throw new Error('Semester no longer exists');
  s.archived = archived; if (archived) s.active = false;
}
export async function saveCourse(course: CourseInput): Promise<void> {
  if (native()) return invoke('save_course', { course });
  const semester = preview.semesters.find(s => s.id === course.semesterId);
  if (!semester) throw new Error('Semester no longer exists');
  if (!course.code.trim() || !course.name.trim()) throw new Error('Course code and name are required');
  const old = preview.courses.find(c => c.id === course.id);
  if (semester.archived && old?.semesterId !== course.semesterId) throw new Error('Courses cannot be added to an archived semester');
  if (preview.courses.some(c => c.id !== course.id && c.semesterId === course.semesterId && c.code.trim().toLowerCase() === course.code.trim().toLowerCase())) throw new Error('This semester already has a course with that code.');
  const now = Date.now();
  preview.courses = [...preview.courses.filter(c => c.id !== course.id), { ...course, code: course.code.trim(), name: course.name.trim(), archived: old?.archived ?? false, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now }];
}
export async function setCourseArchived(id: string, archived: boolean): Promise<void> {
  if (native()) return invoke('set_course_archived', { id, archived });
  const c = preview.courses.find(x => x.id === id);
  if (!c) throw new Error('Course no longer exists');
  c.archived = archived;
}
/** Creates or updates coursework; passing an existing task with another course moves it. */
export async function saveCoursework(coursework: CourseworkInput): Promise<void> {
  if (native()) return invoke('save_coursework', { coursework });
  const course = preview.courses.find(c => c.id === coursework.courseId);
  if (!course) throw new Error('Course no longer exists');
  const link = preview.work.find(w => w.taskId === coursework.task.id);
  if (course.archived && link?.courseId !== course.id) throw new Error('Restore this archived course before adding coursework to it');
  const existing = previewWorkspace().tasks.find(t => t.id === coursework.task.id);
  await saveTask({ ...coursework.task, category: existing ? existing.category : 'School' });
  preview.work = [...preview.work.filter(w => w.taskId !== coursework.task.id), { taskId: coursework.task.id, courseId: coursework.courseId, workType: coursework.workType, referenceNotes: coursework.referenceNotes }];
}
export async function unlinkCoursework(taskId: string): Promise<void> {
  if (native()) return invoke('unlink_coursework', { taskId });
  preview.work = preview.work.filter(w => w.taskId !== taskId);
}
/** Deleting a task removes only its academic link, mirroring ON DELETE CASCADE. */
export async function deleteCourseworkTask(taskId: string): Promise<void> {
  await deleteTask(taskId);
  if (!native()) preview.work = preview.work.filter(w => w.taskId !== taskId);
}
/** Test helper for the browser preview store. */
export function resetAcademicPreview(): void { preview.semesters = []; preview.courses = []; preview.work = []; }
