import { invoke } from '@tauri-apps/api/core';

export interface BrightspaceConfiguration { portalOrigin: string; executablePath: string }
export type BrightspaceState = 'not_configured' | 'configuration_error' | 'cli_unavailable' | 'cli_untrusted' | 'cli_incompatible' | 'cli_timeout' | 'output_too_large' | 'process_error' | 'cancelled' | 'capabilities_verified' | 'authentication_required' | 'credential_present_unverified' | 'portal_mismatch' | 'credential_error' | 'verification_unavailable';
export interface BrightspaceInspection { state: BrightspaceState; profileId: string; portalOrigin: string | null; executablePath: string | null; cliAvailable: boolean; cliCompatible: boolean; liveVerified: boolean; message: string }

const native = () => '__TAURI_INTERNALS__' in window;
export type BrightspaceExecutionPolicy = 'frozen_unapproved' | 'frozen_approved' | 'synthetic_e2e';
export async function brightspaceExecutionPolicy(): Promise<BrightspaceExecutionPolicy> {
  return native() ? invoke('brightspace_execution_policy') : 'frozen_unapproved';
}
let preview: BrightspaceConfiguration | null = null;
export async function brightspaceConfiguration(): Promise<BrightspaceConfiguration | null> { return native() ? invoke('brightspace_configuration') : preview; }
export async function brightspaceSaveConfiguration(portalOrigin: string, executablePath: string): Promise<BrightspaceConfiguration> {
  if (native()) return invoke('brightspace_save_configuration', { portalOrigin, executablePath });
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(portalOrigin) || !executablePath.trim()) throw new Error('Enter a plain HTTPS portal origin and an executable path.');
  preview = { portalOrigin, executablePath }; return preview;
}
export async function brightspaceInspectCapabilities(): Promise<BrightspaceInspection> {
  if (native()) return invoke('brightspace_inspect_capabilities');
  return { state: preview ? 'cli_unavailable' : 'not_configured', profileId: 'civildesk-dev', portalOrigin: preview?.portalOrigin ?? null, executablePath: preview?.executablePath ?? null, cliAvailable: false, cliCompatible: false, liveVerified: false, message: preview ? 'Browser preview cannot launch D2L-CLI.' : 'Add a portal and trusted CLI executable.' };
}
export async function brightspaceCancel(): Promise<void> {
  if (native()) await invoke('brightspace_cancel');
}

export interface BrightspaceCourse { id: string; code: string; name: string; semester_name: string; is_active: boolean; can_access: boolean; is_new_enrollment: boolean; start_date: string | null; end_date: string | null }
export interface BrightspaceCourseSnapshot { portalOrigin: string; mode: 'demo' | 'synthetic_cli'; retrievedAtMs: number; complete: boolean; warnings: string[]; courses: BrightspaceCourse[] }
export type BrightspaceCourseMode = 'demo' | 'synthetic_cli' | 'unavailable';
export async function brightspaceCourseMode(): Promise<BrightspaceCourseMode> { return native() ? invoke('brightspace_course_mode') : 'demo'; }
const demo = (id: string, code: string, name: string, semester_name: string): BrightspaceCourse => ({ id, code, name, semester_name, is_active: true, can_access: true, is_new_enrollment: false, start_date: null, end_date: null });
/** Browser preview is labeled synthetic and never requests Brightspace. */
export async function brightspaceCourses(): Promise<BrightspaceCourseSnapshot> {
  if (native()) return invoke('brightspace_courses');
  return { portalOrigin: 'https://synthetic.example.test', mode: 'demo', retrievedAtMs: Date.now(), complete: true, warnings: [], courses: [demo('610101', 'CIV 201', 'Structures and the Built Environment', 'Sample Fall Term'), demo('610202', 'MATH 240', 'Applied Mathematics for Designers', 'Sample Fall Term'), demo('610303', '', 'A Very Long Sample Course Title for Narrow Windows and Detail Navigation', '')] };
}

export interface BrightspaceAssignment { id: string; course_id: string; name: string; submission_status: string | null; score: string | null; due_date: string | null }
export interface AssignmentCompleteness { status: 'below_page_size_boundary' | 'potentially_truncated' | 'unknown'; observed_row_count: number; page_size_ceiling: number | null }
export interface AssignmentCourseResult { courseId: string; completeness: AssignmentCompleteness | null; error: string | null; assignments: BrightspaceAssignment[] }
export interface AssignmentSnapshot { portalOrigin: string; mode: 'demo' | 'synthetic_cli'; retrievedAtMs: number; courses: BrightspaceCourse[]; results: AssignmentCourseResult[]; limitedCourseCount: boolean }
/** Only the dedicated E2E identity may launch the synthetic CLI. Browser preview is hard-coded. */
export async function brightspaceAssignments(): Promise<AssignmentSnapshot> {
  if (native()) return invoke('brightspace_assignments');
  const catalog = await brightspaceCourses();
  const a = (course_id: string, id: string, name: string, due_date: string | null): BrightspaceAssignment => ({ course_id, id, name, due_date, submission_status: null, score: null });
  const results = catalog.courses.map(course => { const assignments = course.id === '610101' ? [a(course.id, '801', 'Design brief', '2026-11-18T17:00:00'), a(course.id, '802', 'Studio reflection', null)] : course.id === '610202' ? [a(course.id, '801', 'Design brief', '2026-11-18T23:59:00')] : [];
    return { courseId: course.id, completeness: { status: 'below_page_size_boundary' as const, observed_row_count: assignments.length, page_size_ceiling: 50 }, error: null, assignments }; });
  return { portalOrigin: catalog.portalOrigin, mode: 'demo', retrievedAtMs: Date.now(), courses: catalog.courses, results, limitedCourseCount: false };
}

export interface BrightspaceGradeItem { course_id: string; label: string; displayed_points: string | null; displayed_grade: string | null; displayed_weight: string | null; feedback_availability: 'none' | 'present' | 'unknown' }
export interface BrightspaceAnnouncement { course_id: string; announcement_id: string; title: string; body: string | null; detail_reference: string }
export interface ClassPage<T> { courseId: string; retrievedAtMs: number | null; completeness: 'unknown' | null; error: string | null; items: T[] }
export interface ClassSnapshot<T> { portalOrigin: string; mode: 'demo' | 'synthetic_cli'; retrievedAtMs: number; courses: BrightspaceCourse[]; results: ClassPage<T>[]; limitedCourseCount: boolean }
const sampleSnapshot = <T>(courses: BrightspaceCourse[], items: (course: BrightspaceCourse) => T[]): ClassSnapshot<T> => ({
  portalOrigin: 'https://synthetic.example.test', mode: 'demo', retrievedAtMs: Date.now(), courses,
  results: courses.map(course => ({ courseId: course.id, retrievedAtMs: Date.now(), completeness: 'unknown', error: null, items: items(course) })), limitedCourseCount: false,
});
export async function brightspaceGrades(): Promise<ClassSnapshot<BrightspaceGradeItem>> {
  if (native()) return invoke('brightspace_grades');
  const courses = (await brightspaceCourses()).courses;
  return sampleSnapshot(courses, course => [{ course_id: course.id, label: 'Fictional practice set', displayed_points: '0', displayed_grade: null, displayed_weight: null, feedback_availability: 'unknown' }]);
}
export async function brightspaceAnnouncements(): Promise<ClassSnapshot<BrightspaceAnnouncement>> {
  if (native()) return invoke('brightspace_announcements');
  const courses = (await brightspaceCourses()).courses;
  return sampleSnapshot(courses, course => [{ course_id: course.id, announcement_id: '501', title: 'Fictional class update', body: 'Sample details for this fictional class.', detail_reference: `/d2l/le/news/${course.id}/501/view` }]);
}
