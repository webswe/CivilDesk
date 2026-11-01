import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import library from '../../src-tauri/src/challenge_library.json';
import { PortfolioStudio } from './PortfolioStudio';
import { resetPortfolioPreview } from '../services/portfolio';
import type { Project, ProjectsData } from '../services/projects';
import type { ChallengeData } from '../services/challenges';

const project: Project = {
  id: 'p1', title: 'Site grading study', description: 'PRIVATE', discipline: 'Land Development', category: '', projectType: 'Academic exercise', software: ['Civil 3D'],
  startDate: '2026-09-01', targetDate: '2026-10-15', status: 'In Progress', priority: null, createdAtMs: 1, updatedAtMs: 1, completedAtMs: null,
  portfolioCandidate: false, portfolioSummary: '', objectives: '', contributions: '', skills: '', decisions: '', lessons: '',
};
const noData: ProjectsData = { projects: [project], milestones: [], files: [], journal: [] };
const challengeData = (over: Partial<ChallengeData> = {}): ChallengeData => ({ challenges: structuredClone(library), versions: structuredClone(library), settings: { automatic: false, tracks: [], difficulties: [], weeklyCount: 1 }, assignments: [], progress: [], evidence: [], pathways: [], projects: [], ...over });

function mount(props: Partial<Parameters<typeof PortfolioStudio>[0]> = {}) {
  const onProjectChanged = vi.fn(async () => {});
  const view = render(<PortfolioStudio project={project} projects={noData} challenges={null} onProjectChanged={onProjectChanged} setCandidate={async () => {}} {...props}/>);
  return { ...view, onProjectChanged };
}
const section = (name: string) => fireEvent.click(within(screen.getByRole('group', { name: 'Portfolio section' })).getByRole('button', { name }));
const ready = () => screen.findByRole('heading', { name: 'Portfolio Studio' });
const addPath = async (path: string) => {
  fireEvent.change(screen.getByLabelText('Advanced: absolute path to an image'), { target: { value: path } });
  fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
};

describe('Portfolio Studio', () => {
  beforeEach(() => resetPortfolioPreview());
  afterEach(() => cleanup());

  it('starts as an empty private draft and explains what is missing', async () => {
    mount(); await ready();
    expect(screen.getByText(/0 of 7 parts started/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing leaves this computer unless you export it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByText(/Title, discipline, type and dates come from the project/)).toBeInTheDocument();
  });

  it('saves a draft, refreshes the project, and shows it again after a restart', async () => {
    const first = mount(); await ready();
    fireEvent.change(screen.getByLabelText(/Professional summary/), { target: { value: 'Grading study for a school lot' } });
    fireEvent.change(screen.getByLabelText(/Project background/), { target: { value: 'Existing ponding at the lot' } });
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(first.onProjectChanged).toHaveBeenCalled();
    first.unmount();
    // A restart reloads from storage; project-backed fields come from the (refreshed) project record.
    mount({ project: { ...project, portfolioSummary: 'Grading study for a school lot' } }); await ready();
    expect((screen.getByLabelText(/Project background/) as HTMLTextAreaElement).value).toBe('Existing ponding at the lot');
    expect((screen.getByLabelText(/Professional summary/) as HTMLTextAreaElement).value).toBe('Grading study for a school lot');
    expect(screen.getByText(/2 of 7 parts started/)).toBeInTheDocument();
  });

  it('keeps unsaved text when switching sections', async () => {
    mount(); await ready();
    fireEvent.change(screen.getByLabelText(/Professional summary/), { target: { value: 'Draft in progress' } });
    section('Gallery'); section('Write');
    expect((screen.getByLabelText(/Professional summary/) as HTMLTextAreaElement).value).toBe('Draft in progress');
  });

  it('lists software and skills only when the user adds them, and never duplicates', async () => {
    mount(); await ready(); section('Software & skills');
    expect(screen.getByText('No software listed yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Software name'), { target: { value: 'Revit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add software' }));
    expect(await screen.findByRole('button', { name: 'Remove Revit' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Software name'), { target: { value: 'revit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add software' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Revit' }));
    expect(await screen.findByText('No software listed yet.')).toBeInTheDocument();
  });

  it('suggests project software and completed-challenge skills without claiming them', async () => {
    const c = library.find(x => x.skills.length > 0)!;
    const challenges = challengeData({ projects: [{ challengeId: c.id, projectId: 'p1', createdFromChallenge: false }], progress: [{ challengeId: c.id, contentVersion: 1, mode: 'guided', status: 'Completed', notes: 'PRIVATE CHALLENGE NOTE', deadlineDate: null, startedAtMs: 1, completedAtMs: 2, checks: [0] }] });
    mount({ challenges }); await ready(); section('Software & skills');
    expect(screen.getByRole('button', { name: 'Add software Civil 3D' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Add skill / }).length).toBeGreaterThan(0);
    expect(screen.getByText('No skills listed yet.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('PRIVATE CHALLENGE NOTE');
    fireEvent.click(screen.getAllByRole('button', { name: /^Add skill / })[0]!);
    await waitFor(() => expect(screen.queryByText('No skills listed yet.')).not.toBeInTheDocument());
  });

  it('adds, captions, reorders and removes gallery images, and rejects unsupported types', async () => {
    mount(); await ready(); section('Gallery');
    expect(screen.getByText(/No gallery images yet/)).toBeInTheDocument();
    await addPath('C:\\work\\logo.svg');
    expect(await screen.findByRole('alert')).toHaveTextContent(/SVG is not supported/);
    for (const name of ['plan.png', 'profile.jpg']) { await addPath('C:\\work\\' + name); await screen.findByText(name); }
    const rows = () => within(screen.getByRole('list', { name: 'Gallery images' })).getAllByRole('listitem');
    expect(rows()[0]).toHaveTextContent('plan.png');
    fireEvent.change(within(rows()[0]!).getByLabelText('Caption'), { target: { value: 'Existing conditions' } });
    fireEvent.change(within(rows()[0]!).getByLabelText(/Alternative text/), { target: { value: 'Plan view of the lot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save text for plan.png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save text for plan.png' })).toBeDisabled());
    expect((within(rows()[0]!).getByLabelText('Caption') as HTMLInputElement).value).toBe('Existing conditions');
    expect(screen.getByRole('button', { name: 'Move plan.png up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move plan.png down' }));
    await waitFor(() => expect(rows()[0]).toHaveTextContent('profile.jpg'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove plan.png from gallery' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('offers existing project images only as explicit choices', async () => {
    const data: ProjectsData = { ...noData, files: [
      { id: 'f1', projectId: 'p1', displayName: 'site-plan.png', path: 'C:\\w\\site-plan.png', category: 'Drawing', description: '', addedAtMs: 1, missing: false },
      { id: 'f2', projectId: 'p1', displayName: 'model.dwg', path: 'C:\\w\\model.dwg', category: 'Drawing', description: '', addedAtMs: 1, missing: false },
      { id: 'f3', projectId: 'p1', displayName: 'gone.png', path: 'C:\\w\\gone.png', category: 'Drawing', description: '', addedAtMs: 1, missing: true },
    ] };
    mount({ projects: data }); await ready(); section('Gallery');
    expect(screen.getByText(/No gallery images yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Images already attached to this project \(1\)/));
    expect(screen.getByRole('button', { name: 'Add site-plan.png to gallery' })).toBeInTheDocument();
    expect(screen.queryByText('model.dwg')).not.toBeInTheDocument();
    expect(screen.queryByText('gone.png')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add site-plan.png to gallery' }));
    expect(await screen.findByRole('list', { name: 'Gallery images' })).toBeInTheDocument();
  });

  it('selects milestones for the timeline and handles a project with none', async () => {
    mount(); await ready(); section('Timeline');
    expect(screen.getByText(/No milestones yet/)).toBeInTheDocument();
    cleanup(); resetPortfolioPreview();
    const data: ProjectsData = { ...noData, milestones: [
      { id: 'm1', projectId: 'p1', title: 'Survey complete', description: 'PRIVATE NOTE', targetDate: '2026-09-10', completedAtMs: 5, createdAtMs: 1, updatedAtMs: 1 },
      { id: 'm2', projectId: 'p1', title: 'Final plans', description: '', targetDate: '2026-10-10', completedAtMs: null, createdAtMs: 1, updatedAtMs: 1 },
      { id: 'm3', projectId: 'other', title: 'Another project', description: '', targetDate: '2026-10-11', completedAtMs: null, createdAtMs: 1, updatedAtMs: 1 },
    ] };
    mount({ projects: data }); await ready(); section('Timeline');
    expect(screen.queryByText('Another project')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('PRIVATE NOTE');
    fireEvent.click(screen.getByRole('checkbox', { name: /Survey complete/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Survey complete/ })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /Final plans/ })).not.toBeChecked();
  });

  it('says preview and export need the desktop app when running in a browser', async () => {
    mount(); await ready(); section('Preview & export');
    expect(screen.getByText(/Preview and export need the desktop app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export case study' })).not.toBeInTheDocument();
  });
});
