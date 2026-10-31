import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import library from '../src-tauri/src/challenge_library.json';
import { ChallengesPage } from './ChallengesPage';
import type { ChallengeData } from './services/challenges';
import type { ProjectsData } from './services/projects';

const noop = async () => {};
const data = (automatic: boolean): ChallengeData => ({ challenges: structuredClone(library), versions: structuredClone(library), settings: { automatic, tracks: ['AutoCAD', 'Civil 3D', 'Revit'], difficulties: ['Beginner', 'Intermediate', 'Advanced'], weeklyCount: 1 }, assignments: [], progress: [], evidence: [], pathways: [], projects: [] });
const projects = { projects: [] } as unknown as ProjectsData;
const page = (value: ChallengeData) => render(<ChallengesPage data={value} projects={projects} refresh={noop} saveSettings={noop} assign={noop} act={noop} evidence={noop} removeEvidence={noop} link={noop} createProject={noop} />);

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
});
