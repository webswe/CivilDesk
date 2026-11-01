import type { ChallengeData } from '../services/challenges';
import type { CaseStudy, GalleryItem, PortfolioTool } from '../services/portfolio';
import type { Project, ProjectsData } from '../services/projects';

export const skillTitle = (id: string) => id.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
const imageName = /\.(png|jpe?g|gif|webp)$/i;
export const isImagePath = (path: string) => imageName.test(path);

export const blankStudy = (projectId: string): CaseStudy => ({
  projectId, teamKind: 'individual', background: '', scope: '', constraints: '', approach: '', methodology: '', challenges: '', solutions: '', deliverables: '', outcomes: '', createdAtMs: 0, updatedAtMs: 0,
});

/** Where the case study stands, from what the user has actually written. Nothing here is a grade of the work. */
export function readiness(project: Project, study: CaseStudy | undefined, tools: PortfolioTool[], gallery: GalleryItem[]): { done: number; total: number; missing: string[] } {
  const s = study ?? blankStudy(project.id);
  const checks: [string, boolean][] = [
    ['Professional summary', Boolean(project.portfolioSummary.trim())],
    ['Background or objective', Boolean(s.background.trim() || project.objectives.trim())],
    ['Your role', Boolean(project.contributions.trim())],
    ['Software or skills', tools.length > 0],
    ['Approach or process', Boolean(s.approach.trim() || s.methodology.trim())],
    ['Outcomes or deliverables', Boolean(s.outcomes.trim() || s.deliverables.trim())],
    ['At least one image', gallery.some(g => !g.missing)],
  ];
  return { done: checks.filter(c => c[1]).length, total: checks.length, missing: checks.filter(c => !c[1]).map(c => c[0]) };
}

export interface Suggestions {
  software: string[]; skills: { id: string; title: string }[]; images: { path: string; label: string; source: string }[];
}
/**
 * Material that already exists for this project and could be reused. Everything is a suggestion the user must accept:
 * a completed challenge is a self-reported exercise, so it is never converted into a claimed skill automatically.
 * Challenge notes are deliberately not read.
 */
export function suggestionsFor(project: Project, projects: ProjectsData, challenges: ChallengeData | null, tools: PortfolioTool[], gallery: GalleryItem[]): Suggestions {
  const have = (kind: string, name: string) => tools.some(t => t.kind === kind && t.name.toLowerCase() === name.toLowerCase());
  const linked = challenges ? challenges.projects.filter(p => p.projectId === project.id).map(p => p.challengeId) : [];
  const done = challenges ? challenges.progress.filter(p => p.status === 'Completed' && linked.includes(p.challengeId)).map(p => p.challengeId) : [];
  const defs = challenges ? challenges.challenges.filter(c => done.includes(c.id)) : [];
  const software = [...new Set([...project.software, ...defs.map(d => d.track)])].filter(n => !have('software', n));
  const skills = [...new Set(defs.flatMap(d => d.skills))].map(id => ({ id, title: skillTitle(id) })).filter(s => !have('skill', s.title));
  const usedPaths = new Set(projects.files.filter(f => gallery.some(g => g.fileId === f.id)).map(f => f.path.toLowerCase()));
  const fromFiles = projects.files.filter(f => f.projectId === project.id && !f.missing && isImagePath(f.path)).map(f => ({ path: f.path, label: f.displayName, source: 'Project files' }));
  const fromEvidence = challenges ? challenges.evidence.filter(e => done.includes(e.challengeId) && !e.missing && isImagePath(e.path)).map(e => ({ path: e.path, label: e.displayName, source: 'Challenge evidence' })) : [];
  const seen = new Set<string>();
  const images = [...fromFiles, ...fromEvidence].filter(i => { const k = i.path.toLowerCase(); if (usedPaths.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  return { software, skills, images };
}
