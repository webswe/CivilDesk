import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import library from '../src-tauri/src/challenge_library.json';
import { ChallengesPage } from './ChallengesPage';
import type { ChallengeData } from './services/challenges';
import type { ProjectsData } from './services/projects';

const noop = async () => {};
const data = (automatic: boolean): ChallengeData => ({ challenges: structuredClone(library), versions: structuredClone(library), settings: { automatic, tracks: ['AutoCAD', 'Civil 3D', 'Revit'], difficulties: ['Beginner', 'Intermediate', 'Advanced'], weeklyCount: 1 }, assignments: [], progress: [], evidence: [], pathways: [], projects: [] });
const projects = { projects: [] } as unknown as ProjectsData;
const page = (value: ChallengeData, options: Partial<Parameters<typeof ChallengesPage>[0]> = {}) => render(<ChallengesPage data={value} projects={projects} refresh={noop} saveSettings={noop} assign={noop} act={noop} evidence={noop} removeEvidence={noop} link={noop} createProject={async () => 'project-1'} {...options}/>);

describe('weekly challenge board', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 4, 10, 0)); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('previews next week using the saved preferences when automatic assignment is on', () => {
    page(data(true));
    const upcoming = screen.getByRole('heading', { name: 'Upcoming · 2026-11-09' }).closest('section')!;
    expect(within(upcoming).getByText(/Assignments are saved only when that week begins/)).toBeTruthy();
    expect(within(upcoming).getByText('Import survey points and build existing ground')).toBeTruthy();
  });

  it('explains that nothing is previewed when automatic assignment is off', () => {
    page(data(false));
    const upcoming = screen.getByRole('heading', { name: 'Upcoming · 2026-11-09' }).closest('section')!;
    expect(within(upcoming).getByText(/Automatic weekly assignments are off/)).toBeTruthy();
    expect(within(upcoming).queryByRole('button')).toBeNull();
  });

  it('explains that fully checked criteria still need an explicit completion', () => {
    const value = data(false); const c = value.challenges[0]!;
    const progress = (checks: number[], status: 'In Progress' | 'Completed') => ({ challengeId: c.id, contentVersion: 1, mode: 'guided' as const, status, notes: '', deadlineDate: null, startedAtMs: 1, completedAtMs: status === 'Completed' ? 2 : null, checks });
    const all = c.checklist.map((_, i) => i);
    value.progress = [progress(all.slice(1), 'In Progress')];
    const first = page(value);
    fireEvent.click(screen.getByRole('button', { name: 'Library' })); fireEvent.click(screen.getByRole('button', { name: new RegExp(c.title) }));
    expect(screen.queryByText(/Every criterion is checked/)).toBeNull();
    first.unmount();
    value.progress = [progress(all, 'In Progress')];
    page(value);
    fireEvent.click(screen.getByRole('button', { name: 'Library' })); fireEvent.click(screen.getByRole('button', { name: new RegExp(c.title) }));
    expect(screen.getByRole('status')).toHaveTextContent(/Every criterion is checked/);
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeEnabled();
    expect(screen.getByText(`${all.length} of ${all.length} criteria checked`)).toBeTruthy();
  });

  it('opens the linked project and its case study without exposing the evidence path', () => {
    const value = data(false); const challenge = value.challenges[0]!;
    value.projects = [{ challengeId: challenge.id, projectId: 'project-1', createdFromChallenge: false }];
    value.evidence = [{ id: 'file-1', challengeId: challenge.id, displayName: 'drawing.dwg', path: 'C:\\Private\\drafts\\drawing.dwg', category: 'Drawing', addedAtMs: 1, missing: false }];
    const openProject = vi.fn();
    page(value, { initialChallengeId: challenge.id, projects: { ...projects, projects: [{ id: 'project-1', title: 'Site drawing' }] } as ProjectsData, openProject });
    expect(screen.getAllByText('Site drawing')).toHaveLength(2);
    expect(screen.queryByText(/C:\\Private/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open case study' }));
    expect(openProject).toHaveBeenNthCalledWith(1, 'project-1');
    expect(openProject).toHaveBeenNthCalledWith(2, 'project-1', 'Portfolio');
  });
  it('focuses an exact scheduled challenge and offers Calendar return and date navigation',()=>{
    const value=data(false), c=value.challenges[0]!, backToCalendar=vi.fn(), openCalendar=vi.fn();
    value.progress=[{challengeId:c.id,contentVersion:c.version,mode:'guided',status:'In Progress',notes:'',deadlineDate:'2026-11-18',startedAtMs:1,completedAtMs:null,checks:[]}];
    const before=structuredClone(value);
    page(value,{initialChallengeId:c.id,backToCalendar,openCalendar});
    expect(screen.getByRole('heading',{name:c.title})).toHaveFocus();
    fireEvent.click(screen.getByRole('button',{name:'View on Calendar'}));
    expect(openCalendar).toHaveBeenCalledWith(c.id,'2026-11-18');
    fireEvent.click(screen.getByRole('button',{name:'Back to Calendar'}));
    expect(backToCalendar).toHaveBeenCalledOnce();
    expect(value).toEqual(before);
  });
  it('keeps a saved historical version available and handles a missing one safely',()=>{
    const value=data(false), c=value.challenges[0]!;
    value.progress=[{challengeId:c.id,contentVersion:c.version,mode:'guided',status:'In Progress',notes:'',deadlineDate:'2026-11-18',startedAtMs:1,completedAtMs:null,checks:[]}];
    value.challenges=value.challenges.filter(x=>x.id!==c.id);
    const old=page(value,{initialChallengeId:c.id,backToCalendar:vi.fn()});
    expect(screen.getByRole('heading',{name:c.title})).toHaveFocus();
    old.unmount();
    value.versions=value.versions.filter(x=>x.id!==c.id);
    value.challenges=[c,...value.challenges];
    const backToCalendar=vi.fn();
    page(value,{initialChallengeId:c.id,backToCalendar});
    expect(screen.getByRole('heading',{name:'Challenge unavailable'})).toHaveFocus();
    fireEvent.click(screen.getByRole('button',{name:'Back to Calendar'}));
    expect(backToCalendar).toHaveBeenCalledOnce();
  });
});
