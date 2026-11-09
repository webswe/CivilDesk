import { invoke } from '@tauri-apps/api/core';

export interface BrightspaceConfiguration { portalOrigin: string; executablePath: string }
export type BrightspaceState = 'not_configured' | 'configuration_error' | 'cli_unavailable' | 'cli_untrusted' | 'cli_incompatible' | 'cli_timeout' | 'output_too_large' | 'process_error' | 'cancelled' | 'authentication_required' | 'credential_present_unverified' | 'portal_mismatch' | 'credential_error' | 'verification_unavailable';
export interface BrightspaceInspection { state: BrightspaceState; profileId: string; portalOrigin: string | null; executablePath: string | null; cliAvailable: boolean; cliCompatible: boolean; liveVerified: boolean; message: string }

const native = () => '__TAURI_INTERNALS__' in window;
let preview: BrightspaceConfiguration | null = null;
export async function brightspaceConfiguration(): Promise<BrightspaceConfiguration | null> { return native() ? invoke('brightspace_configuration') : preview; }
export async function brightspaceSaveConfiguration(portalOrigin: string, executablePath: string): Promise<BrightspaceConfiguration> {
  if (native()) return invoke('brightspace_save_configuration', { portalOrigin, executablePath });
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(portalOrigin) || !executablePath.trim()) throw new Error('Enter a plain HTTPS portal origin and an executable path.');
  preview = { portalOrigin, executablePath }; return preview;
}
export async function brightspaceInspect(): Promise<BrightspaceInspection> {
  if (native()) return invoke('brightspace_inspect');
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
