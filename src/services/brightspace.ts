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
