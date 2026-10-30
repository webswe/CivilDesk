import { invoke } from '@tauri-apps/api/core';
import type { AppSnapshot } from '../domain/types';
import { defaultSnapshot } from '../domain/types';

const browserKey = 'civildesk.preview.v1';
const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function loadSnapshot(): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('load_snapshot');
  const value = localStorage.getItem(browserKey);
  if (!value) return structuredClone(defaultSnapshot);
  try { return JSON.parse(value) as AppSnapshot; } catch { throw new Error('Preview preferences could not be read.'); }
}

export async function saveSnapshot(snapshot: AppSnapshot): Promise<void> {
  if (isTauri()) return invoke('save_snapshot', { snapshot });
  localStorage.setItem(browserKey, JSON.stringify(snapshot));
}
