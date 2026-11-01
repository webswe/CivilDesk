import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export type TeamKind = 'individual' | 'team';
export interface CaseStudy {
  projectId: string; teamKind: TeamKind; background: string; scope: string; constraints: string; approach: string; methodology: string;
  challenges: string; solutions: string; deliverables: string; outcomes: string; createdAtMs: number; updatedAtMs: number;
}
/** Case-study-only fields plus the presentation fields that live on the project record itself. */
export interface CaseStudyInput {
  projectId: string; teamKind: TeamKind; background: string; scope: string; constraints: string; approach: string; methodology: string;
  challenges: string; solutions: string; deliverables: string; outcomes: string;
  portfolioSummary: string; objectives: string; contributions: string; decisions: string; lessons: string;
}
export type ToolKind = 'software' | 'skill';
export interface ToolInput { kind: ToolKind; name: string; skillId: string | null }
export interface PortfolioTool extends ToolInput { id: string; projectId: string; position: number }
export interface GalleryItem { id: string; projectId: string; fileId: string; caption: string; altText: string; position: number; displayName: string; missing: boolean }
export interface MilestoneSelection { projectId: string; milestoneId: string }
export interface PortfolioData { studies: CaseStudy[]; tools: PortfolioTool[]; gallery: GalleryItem[]; milestones: MilestoneSelection[] }
export interface PreviewResult { html: string; included: string[]; warnings: string[] }
export interface ExportResult { folder: string; files: string[]; warnings: string[] }

const native = () => '__TAURI_INTERNALS__' in window;
/** Browser preview only: authoring works, but previews and exports need the desktop app. */
let memory: PortfolioData = { studies: [], tools: [], gallery: [], milestones: [] };
export function resetPortfolioPreview() { memory = { studies: [], tools: [], gallery: [], milestones: [] }; }
export const isNativePortfolio = native;

export const loadPortfolio = async (): Promise<PortfolioData> => native() ? invoke('load_portfolio') : structuredClone(memory);

export async function saveCaseStudy(input: CaseStudyInput): Promise<void> {
  if (native()) return invoke('save_case_study', { input });
  const now = Date.now(); const old = memory.studies.find(s => s.projectId === input.projectId);
  const own: CaseStudy = { projectId: input.projectId, teamKind: input.teamKind, background: input.background, scope: input.scope, constraints: input.constraints, approach: input.approach, methodology: input.methodology, challenges: input.challenges, solutions: input.solutions, deliverables: input.deliverables, outcomes: input.outcomes, createdAtMs: old?.createdAtMs ?? now, updatedAtMs: now };
  memory.studies = [...memory.studies.filter(s => s.projectId !== input.projectId), own];
}
export async function setPortfolioTools(projectId: string, tools: ToolInput[]): Promise<void> {
  if (native()) return invoke('set_portfolio_tools', { projectId, tools });
  const seen = new Set<string>();
  const kept = tools.filter(t => { const key = t.kind + ':' + t.name.trim().toLowerCase(); if (!t.name.trim() || seen.has(key)) return false; seen.add(key); return true; });
  memory.tools = [...memory.tools.filter(t => t.projectId !== projectId), ...kept.map((t, position) => ({ ...t, name: t.name.trim(), id: projectId + ':' + t.kind + ':' + position, projectId, position }))];
}
export async function setPortfolioMilestones(projectId: string, milestoneIds: string[]): Promise<void> {
  if (native()) return invoke('set_portfolio_milestones', { projectId, milestoneIds });
  memory.milestones = [...memory.milestones.filter(m => m.projectId !== projectId), ...milestoneIds.map(milestoneId => ({ projectId, milestoneId }))];
}
export async function addGalleryImage(projectId: string, path: string): Promise<void> {
  if (native()) return invoke('add_gallery_image', { projectId, path });
  if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) throw new Error('Supported image types are PNG, JPEG, GIF and WebP (SVG is not supported)');
  const mine = memory.gallery.filter(g => g.projectId === projectId);
  if (mine.some(g => g.displayName === path.split(/[\\/]/).pop())) throw new Error('That image is already in the gallery');
  const id = crypto.randomUUID();
  memory.gallery = [...memory.gallery, { id, projectId, fileId: id, caption: '', altText: '', position: mine.length, displayName: path.split(/[\\/]/).pop() || path, missing: false }];
}
export async function saveGalleryItem(id: string, caption: string, altText: string): Promise<void> {
  if (native()) return invoke('save_gallery_item', { id, caption, altText });
  memory.gallery = memory.gallery.map(g => g.id === id ? { ...g, caption, altText } : g);
}
export async function reorderGallery(projectId: string, ids: string[]): Promise<void> {
  if (native()) return invoke('reorder_gallery', { projectId, ids });
  memory.gallery = memory.gallery.map(g => g.projectId === projectId ? { ...g, position: ids.indexOf(g.id) } : g);
}
export async function removeGalleryItem(id: string): Promise<void> {
  if (native()) return invoke('remove_gallery_item', { id });
  memory.gallery = memory.gallery.filter(g => g.id !== id);
}
export const galleryImageData = async (id: string): Promise<string> => native() ? invoke('gallery_image_data', { id }) : Promise.reject(new Error('Image previews are available in the desktop app'));
export const previewCaseStudy = async (projectId: string): Promise<PreviewResult> => native() ? invoke('preview_case_study', { projectId }) : Promise.reject(new Error('The portfolio preview is available in the desktop app'));
export const exportCaseStudy = async (projectId: string, destination: string, overwrite: boolean): Promise<ExportResult> => native() ? invoke('export_case_study', { projectId, destination, overwrite }) : Promise.reject(new Error('Export is available in the desktop app'));

const imageTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
/** The dialog returns paths only; Rust validates the content and stores references, never the bytes. */
export async function browseImages(): Promise<string[]> {
  if (!native()) return [];
  const selected = await open({ title: 'Select portfolio images', multiple: true, directory: false, filters: [{ name: 'Images', extensions: imageTypes }] });
  return selected === null ? [] : Array.isArray(selected) ? selected : [selected];
}
export async function browseFolder(): Promise<string | null> {
  if (!native()) return null;
  const selected = await open({ title: 'Choose where to save the case study', multiple: false, directory: true });
  return typeof selected === 'string' ? selected : null;
}
