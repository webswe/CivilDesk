import { invoke } from '@tauri-apps/api/core';
import type { CalendarEvent, ReminderPreferences } from './calendar';

export interface Subtask { id: string; title: string; done: boolean }
export interface Task {
  id: string; title: string; description: string; category: string; priority: 'low' | 'normal' | 'high';
  dueDate: string | null; dueTime: string | null; subtasks: Subtask[]; reminderOffsetMinutes: number | null;
  createdAtMs: number; updatedAtMs: number; completedAtMs: number | null; firstCompletedAtMs: number | null;
}
export type TaskInput = Pick<Task, 'id' | 'title' | 'description' | 'category' | 'priority' | 'dueDate' | 'dueTime' | 'subtasks' | 'reminderOffsetMinutes'>;
export interface FocusSession {
  id: string; taskId: string | null; status: 'running' | 'paused' | 'stopped' | 'completed';
  durationMinutes: number; breakMinutes: number; startedAtMs: number; runStartedAtMs: number | null;
  elapsedMs: number; finishedAtMs: number | null;
}
export interface RewardEvent { id: string; kind: string; sourceId: string; occurredAtMs: number; xp: number }
export interface Progression {
  xp: number; level: number; earned: string[]; unlocked: string[]; styleId: 'classic' | 'berry';
  scarf: boolean; headphones: boolean; history: RewardEvent[];
}
export interface WorkspaceData {
  tasks: Task[]; sessions: FocusSession[]; events: CalendarEvent[]; reminderPreferences: ReminderPreferences;
  focusDurationMinutes: number; breakDurationMinutes: number; progression: Progression;
}
export const achievementDefinitions = [
  { id: 'first_task', title: 'First step', requirement: 'Complete your first task', cosmetic: 'Rosewood scarf' },
  { id: 'five_tasks', title: 'Building momentum', requirement: 'Complete five different tasks', cosmetic: 'Berry Pip style' },
  { id: 'first_focus', title: 'Deep work begins', requirement: 'Complete one focus session', cosmetic: null },
  { id: 'three_focus', title: 'In the zone', requirement: 'Complete three focus sessions', cosmetic: 'Headphones' },
  { id: 'level_five', title: 'Steady progress', requirement: 'Reach level 5', cosmetic: 'Celebration aura' },
] as const;
export const cosmeticDefinitions = [
  { id: 'classic', title: 'Classic Pip', requirement: 'Available from the start', slot: 'style' },
  { id: 'berry', title: 'Berry Pip', requirement: 'Complete five different tasks', slot: 'style' },
  { id: 'scarf', title: 'Rosewood scarf', requirement: 'Complete your first task', slot: 'accessory' },
  { id: 'headphones', title: 'Focus headphones', requirement: 'Complete three focus sessions', slot: 'accessory' },
] as const;

const native = () => '__TAURI_INTERNALS__' in window;
const preview: WorkspaceData = {
  tasks: [], sessions: [], events: [], reminderPreferences: { enabled: true, quietStart: '22:00', quietEnd: '08:00' }, focusDurationMinutes: 25, breakDurationMinutes: 5,
  progression: { xp: 0, level: 1, earned: [], unlocked: [], styleId: 'classic', scarf: false, headphones: false, history: [] },
};
export function previewWorkspace(): WorkspaceData { return preview; }
const clone = <T,>(value: T): T => structuredClone(value);
export async function loadWorkspace(): Promise<WorkspaceData> {
  return native() ? invoke<WorkspaceData>('load_workspace') : clone(preview);
}
export async function saveTask(task: TaskInput): Promise<void> {
  if (native()) return invoke('save_task', { task });
  const now = Date.now();
  const old = preview.tasks.find(t => t.id === task.id);
  preview.tasks = [{ ...task, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now, completedAtMs: old?.completedAtMs ?? null, firstCompletedAtMs: old?.firstCompletedAtMs ?? null }, ...preview.tasks.filter(t => t.id !== task.id)];
}
export async function deleteTask(id: string): Promise<void> {
  if (native()) return invoke('delete_task', { id });
  preview.tasks = preview.tasks.filter(t => t.id !== id);
}
export async function setTaskCompleted(id: string, completed: boolean): Promise<void> {
  if (native()) return invoke('set_task_completed', { id, completed });
  const t = preview.tasks.find(t => t.id === id);
  if (!t || Boolean(t.completedAtMs) === completed) return;
  const now = Date.now();
  t.completedAtMs = completed ? now : null;
  if (completed && !t.firstCompletedAtMs) {
    t.firstCompletedAtMs = now;
    preview.progression.xp += 25;
    preview.progression.level = Math.floor(preview.progression.xp / 100) + 1;
    preview.progression.history.unshift({ id: 'task_completed:' + id, kind: 'task_completed', sourceId: id, occurredAtMs: now, xp: 25 });
    if (preview.progression.history.filter(e => e.kind === 'task_completed').length === 1) {
      preview.progression.earned.push('first_task'); preview.progression.unlocked.push('scarf');
    }
    if (preview.progression.history.filter(e => e.kind === 'task_completed').length === 5) {
      preview.progression.earned.push('five_tasks'); preview.progression.unlocked.push('berry');
    }
  }
}
export async function setFocusDefaults(duration: number, breakMinutes: number): Promise<void> {
  if (native()) return invoke('set_focus_defaults', { duration, breakMinutes });
  preview.focusDurationMinutes = duration; preview.breakDurationMinutes = breakMinutes;
}
export async function focusAction(action: 'start' | 'pause' | 'resume' | 'stop' | 'complete', id: string, taskId: string | null = null, duration = 0, breakMinutes = 0): Promise<void> {
  if (native()) return invoke('focus_action', { action, id, taskId, duration, breakMinutes });
  const now = Date.now();
  if (action === 'start') { preview.sessions.unshift({ id, taskId, status: 'running', durationMinutes: duration, breakMinutes, startedAtMs: now, runStartedAtMs: now, elapsedMs: 0, finishedAtMs: null }); return; }
  const s = preview.sessions.find(x => x.id === id);
  if (!s) throw new Error('Session unavailable');
  const elapsed = s.elapsedMs + (s.runStartedAtMs ? Math.max(0, now - s.runStartedAtMs) : 0);
  if (action === 'complete' && (s.status !== 'running' || elapsed < s.durationMinutes * 60_000)) throw new Error('Focus time has not finished');
  if (action === 'pause') { s.elapsedMs = elapsed; s.runStartedAtMs = null; s.status = 'paused'; }
  if (action === 'resume') { s.runStartedAtMs = now; s.status = 'running'; }
  if (action === 'stop' || action === 'complete') {
    s.elapsedMs = elapsed; s.runStartedAtMs = null; s.status = action === 'stop' ? 'stopped' : 'completed'; s.finishedAtMs = now;
  }
}
export async function equipCosmetic(id: string, equipped: boolean): Promise<void> {
  if (native()) return invoke('equip_cosmetic', { id, equipped });
  if (id !== 'classic' && equipped && !preview.progression.unlocked.includes(id)) throw new Error('This cosmetic is still locked');
  if (id === 'classic' || id === 'berry') preview.progression.styleId = equipped ? id : 'classic';
  if (id === 'scarf') preview.progression.scarf = equipped;
  if (id === 'headphones') preview.progression.headphones = equipped;
}
