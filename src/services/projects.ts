import { invoke } from '@tauri-apps/api/core';
import { previewWorkspace } from './workspace';

export type ProjectStatus = 'Planning' | 'In Progress' | 'On Hold' | 'Completed' | 'Archived';
export interface Project {
  id: string; title: string; description: string; discipline: string; category: string; projectType: string;
  software: string[]; startDate: string | null; targetDate: string | null; status: ProjectStatus;
  priority: 'low' | 'normal' | 'high' | null; createdAtMs: number; updatedAtMs: number; completedAtMs: number | null;
  portfolioCandidate: boolean; portfolioSummary: string; objectives: string; contributions: string;
  skills: string; decisions: string; lessons: string;
}
export interface Milestone { id: string; projectId: string; title: string; description: string; targetDate: string; completedAtMs: number | null; createdAtMs: number; updatedAtMs: number }
export interface FileReference { id: string; projectId: string; displayName: string; path: string; category: string; description: string; addedAtMs: number; missing: boolean }
export interface JournalEntry { id: string; projectId: string; title: string; entryDate: string; description: string; workCompleted: string; problems: string; solutions: string; skills: string; fileIds: string[]; createdAtMs: number; updatedAtMs: number }
export interface ProjectsData { projects: Project[]; milestones: Milestone[]; files: FileReference[]; journal: JournalEntry[] }
export type EngineeringDomainEvent =
  | { kind: 'first_project_created'; projectId: string }
  | { kind: 'first_milestone_completed'; projectId: string; milestoneId: string }
  | { kind: 'first_project_finished'; projectId: string }
  | { kind: 'portfolio_ready_project_completed'; projectId: string };
// Phase 3A records no engineering XP. These event contracts are reserved for Phase 3C.
const native = () => '__TAURI_INTERNALS__' in window;
const preview: ProjectsData = { projects: [], milestones: [], files: [], journal: [] };
const clone = <T,>(x: T): T => structuredClone(x);
export const loadProjects = async (): Promise<ProjectsData> => native() ? invoke('load_projects') : clone(preview);
export async function saveProject(project: Project) {
  if (native()) return invoke<void>('save_project', { project });
  const now = Date.now(); const old = preview.projects.find(p => p.id === project.id);
  preview.projects = [{ ...project, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now, completedAtMs: project.status === 'Completed' ? old?.completedAtMs ?? now : project.status === 'Archived' ? old?.completedAtMs ?? null : null }, ...preview.projects.filter(p => p.id !== project.id)];
}
export async function saveMilestone(milestone: Milestone) {
  if (native()) return invoke<void>('save_milestone', { milestone });
  const now = Date.now(); const old = preview.milestones.find(m => m.id === milestone.id);
  preview.milestones = [{ ...milestone, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now, completedAtMs: old?.completedAtMs ?? null }, ...preview.milestones.filter(m => m.id !== milestone.id)];
}
export async function setMilestoneCompleted(id: string, completed: boolean) {
  if (native()) return invoke<void>('set_milestone_completed', { id, completed });
  const m = preview.milestones.find(m => m.id === id); if (m) m.completedAtMs = completed ? Date.now() : null;
}
export async function deleteProjectItem(kind: 'milestone' | 'file' | 'journal', id: string) {
  if (native()) return invoke<void>('delete_project_item', { kind, id });
  if (kind === 'milestone') preview.milestones = preview.milestones.filter(x => x.id !== id);
  if (kind === 'file') preview.files = preview.files.filter(x => x.id !== id);
  if (kind === 'journal') preview.journal = preview.journal.filter(x => x.id !== id);
}
export async function associateTask(taskId: string, projectId: string | null) {
  if (native()) return invoke<void>('associate_task', { taskId, projectId });
  const task = previewWorkspace().tasks.find(t => t.id === taskId); if (task) task.projectId = projectId;
}
export async function saveProjectFile(file: FileReference) {
  if (native()) return invoke<void>('save_project_file', { file });
  preview.files = [{ ...file, addedAtMs: Date.now() }, ...preview.files.filter(f => f.id !== file.id)];
}
export async function openProjectFile(id: string) { return invoke<void>('open_project_file', { id }); }
export async function saveJournalEntry(entry: JournalEntry) {
  if (native()) return invoke<void>('save_journal_entry', { entry });
  const now = Date.now(); const old = preview.journal.find(j => j.id === entry.id);
  preview.journal = [{ ...entry, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now }, ...preview.journal.filter(j => j.id !== entry.id)];
}

/** Equal weight for every associated task and milestone. With no recorded work, progress is 0%. */
export function projectProgress(projectId: string, tasks: { projectId: string | null; completedAtMs: number | null }[], milestones: Milestone[]): number {
  const t = tasks.filter(x => x.projectId === projectId); const m = milestones.filter(x => x.projectId === projectId);
  const total = t.length + m.length;
  return total ? Math.round(100 * (t.filter(x => x.completedAtMs !== null).length + m.filter(x => x.completedAtMs !== null).length) / total) : 0;
}

export function selectProjects(data: ProjectsData, tasks: { projectId: string | null; completedAtMs: number | null }[], search: string, discipline: string, status: string, sort: string): Project[] {
  const query=search.toLocaleLowerCase();
  return data.projects.filter(p=>(status==='all'||(status==='active'?p.status!=='Archived':p.status===status)) && (!discipline||p.discipline===discipline) && (p.title+' '+p.description+' '+p.category).toLocaleLowerCase().includes(query))
    .sort((a,b)=>sort==='name'?a.title.localeCompare(b.title):sort==='progress'?projectProgress(b.id,tasks,data.milestones)-projectProgress(a.id,tasks,data.milestones):sort==='target'?(a.targetDate||'9999').localeCompare(b.targetDate||'9999'):b.updatedAtMs-a.updatedAtMs);
}
