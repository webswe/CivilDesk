import { describe, expect, it } from 'vitest';
import library from '../../src-tauri/src/challenge_library.json';
import { blankStudy, isImagePath, readiness, skillTitle, suggestionsFor } from './portfolio';
import type { Project, ProjectsData } from '../services/projects';
import type { ChallengeData } from '../services/challenges';

const project = { id: 'p', title: 'T', software: ['Revit'], portfolioSummary: '', objectives: '', contributions: '' } as unknown as Project;
const none: ProjectsData = { projects: [], milestones: [], files: [], journal: [] };
const data = (over: Partial<ChallengeData>): ChallengeData => ({ challenges: structuredClone(library), versions: [], settings: { automatic: false, tracks: [], difficulties: [], weeklyCount: 1 }, assignments: [], progress: [], evidence: [], pathways: [], projects: [], ...over });
const done = (challengeId: string) => ({ challengeId, contentVersion: 1, mode: 'guided' as const, status: 'Completed' as const, notes: '', deadlineDate: null, startedAtMs: 1, completedAtMs: 2, checks: [] });

describe('portfolio domain', () => {
  it('measures readiness from what was written and names what is missing', () => {
    expect(readiness(project, undefined, [], [])).toMatchObject({ done: 0, total: 7 });
    const filled = readiness({ ...project, portfolioSummary: 'x', contributions: 'y' }, { ...blankStudy('p'), approach: 'z' }, [{ id: 't', projectId: 'p', kind: 'software', name: 'Revit', skillId: null, position: 0 }], []);
    expect(filled.done).toBe(4);
    expect(filled.missing).toContain('At least one image');
    const missingOnly = readiness(project, undefined, [], [{ id: 'g', projectId: 'p', fileId: 'f', caption: '', altText: '', position: 0, displayName: 'a.png', missing: true }]);
    expect(missingOnly.missing).toContain('At least one image');
  });
  it('turns skill ids into readable titles', () => { expect(skillTitle('site-grading')).toBe('Site Grading'); });
  it('recognises only raster image paths', () => {
    for (const ok of ['a.png', 'B.JPG', 'c.jpeg', 'd.gif', 'e.webp']) expect(isImagePath(ok)).toBe(true);
    for (const no of ['a.svg', 'a.dwg', 'a.png.exe', 'a']) expect(isImagePath(no)).toBe(false);
  });
  it('suggests only from completed challenges linked to this project', () => {
    const c = library.find(x => x.skills.length)!;
    const link = [{ challengeId: c.id, projectId: 'p', createdFromChallenge: false }];
    const started = data({ projects: link, progress: [{ ...done(c.id), status: 'In Progress', completedAtMs: null }] });
    expect(suggestionsFor(project, none, started, [], []).skills).toEqual([]);
    const completed = data({ projects: link, progress: [done(c.id)] });
    expect(suggestionsFor(project, none, completed, [], []).skills.length).toBe(new Set(c.skills).size);
    expect(suggestionsFor({ ...project, id: 'other' }, none, completed, [], []).skills).toEqual([]);
    const already = suggestionsFor(project, none, completed, [{ id: 'x', projectId: 'p', kind: 'skill', name: skillTitle(c.skills[0]!).toLowerCase(), skillId: null, position: 0 }], []);
    expect(already.skills.map(s => s.id)).not.toContain(c.skills[0]);
  });
  it('suggests images from project files and challenge evidence, skipping missing, non-image, foreign and used ones', () => {
    const c = library[0]!;
    const file = (id: string, projectId: string, name: string, missing = false) => ({ id, projectId, displayName: name, path: 'C:\\' + name, category: '', description: '', addedAtMs: 1, missing });
    const files = [file('f1', 'p', 'a.png'), file('f2', 'p', 'b.dwg'), file('f3', 'p', 'c.png', true), file('f4', 'other', 'd.png')];
    const ch = data({
      projects: [{ challengeId: c.id, projectId: 'p', createdFromChallenge: false }], progress: [done(c.id)],
      evidence: [{ id: 'e1', challengeId: c.id, displayName: 'proof.jpg', path: 'C:\\proof.jpg', category: '', addedAtMs: 1, missing: false }, { id: 'e2', challengeId: c.id, displayName: 'a-copy.png', path: 'c:\\A.PNG', category: '', addedAtMs: 1, missing: false }],
    });
    expect(suggestionsFor(project, { ...none, files }, ch, [], []).images.map(i => i.label)).toEqual(['a.png', 'proof.jpg']);
    const used = suggestionsFor(project, { ...none, files }, ch, [], [{ id: 'g', projectId: 'p', fileId: 'f1', caption: '', altText: '', position: 0, displayName: 'a.png', missing: false }]);
    expect(used.images.map(i => i.label)).toEqual(['proof.jpg']);
  });
});
