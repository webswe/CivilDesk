import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './../App';
import { AchievementsPage, CustomizationPage } from '../ProductivityPages';
import { defaultWorkspaceForTests } from '../test/fixtures';
import { achievementProgress } from '../domain/pip';

const noop = () => undefined;
const progression = (over: Partial<ReturnType<typeof defaultWorkspaceForTests>['progression']> = {}) => ({ ...defaultWorkspaceForTests().progression, ...over });

describe('wardrobe', () => {
  afterEach(() => cleanup());
  it('shows locked and unlocked states and never offers to equip a locked item', () => {
    const equip = vi.fn(async () => undefined);
    const data = { ...defaultWorkspaceForTests(), progression: progression({ unlocked: ['scarf'], earned: ['first_task'] }) };
    render(<CustomizationPage data={data} goTo={noop} state="awake" reducedMotion={false} equip={equip}/>);
    const dusk = screen.getByText('Dusk Pip').closest('article')!;
    expect(within(dusk).getByText(/Locked · Complete ten different tasks/)).toBeInTheDocument();
    const lockedButton = within(dusk).getByRole('button', { name: 'Locked' });
    expect(lockedButton).toBeDisabled();
    fireEvent.click(lockedButton);
    expect(equip).not.toHaveBeenCalled();
    const scarf = screen.getByText('Rosewood scarf').closest('article')!;
    fireEvent.click(within(scarf).getByRole('button', { name: 'Equip' }));
    expect(equip).toHaveBeenCalledWith('scarf', true);
  });
  it('previews a style without equipping it, and a restored default look unequips', async () => {
    const equip = vi.fn(async () => undefined);
    const data = { ...defaultWorkspaceForTests(), progression: progression({ unlocked: ['sage'], styleId: 'classic' }) };
    render(<CustomizationPage data={data} goTo={noop} state="awake" reducedMotion={false} equip={equip}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Sage Pip' }));
    expect(screen.getByText('Previewing Sage Pip')).toBeInTheDocument();
    expect(equip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore default look' }));
    await waitFor(() => expect(equip).toHaveBeenCalledWith('headphones', false));
    expect(equip).toHaveBeenCalledWith('classic', true);
  });
  it('marks the equipped style and restores the saved appearance', () => {
    const data = { ...defaultWorkspaceForTests(), progression: progression({ unlocked: ['dusk'], styleId: 'dusk' }) };
    render(<CustomizationPage data={data} goTo={noop} state="awake" reducedMotion={false} equip={async () => undefined}/>);
    expect(within(screen.getByText('Dusk Pip').closest('article')!).getByRole('button', { name: 'Equipped' })).toBeDisabled();
    expect(screen.getByRole('img', { name: /Pip is awake/ })).toBeInTheDocument();
  });
});

describe('achievement progress', () => {
  afterEach(() => cleanup());
  it('derives only what the stored data can establish', () => {
    const hist = (n: number, kind: string) => Array.from({ length: n }, () => ({ kind }));
    expect(achievementProgress('five_tasks', { xp: 75, history: hist(3, 'task_completed') })).toEqual({ current: 3, target: 5 });
    expect(achievementProgress('ten_focus', { xp: 100, history: hist(2, 'focus_completed') })).toEqual({ current: 2, target: 10 });
    expect(achievementProgress('level_five', { xp: 900, history: [] })).toEqual({ current: 400, target: 400 });
    expect(achievementProgress('unknown', { xp: 0, history: [] })).toBeNull();
  });
  it('shows progress only on achievements that are not yet earned', () => {
    const data = { ...defaultWorkspaceForTests(), progression: progression({ xp: 75, earned: ['first_task'], history: [1, 2, 3].map(i => ({ id: 't' + i, kind: 'task_completed', sourceId: 's' + i, occurredAtMs: i, xp: 25 })) }) };
    render(<AchievementsPage data={data} goTo={noop}/>);
    const five = screen.getByText('Building momentum').closest('article')!;
    expect(within(five).getByText('Progress: 3 of 5')).toBeInTheDocument();
    expect(within(screen.getByText('First step').closest('article')!).queryByText(/Progress:/)).toBeNull();
  });
});

describe('Pip in the application', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove('reduced-motion'); });
  afterEach(() => cleanup());
  async function start() {
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Casey' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: /Casey/ });
  }
  it('keeps click reactions out of the saved companion record and out of XP', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Pet Pip' }));
    expect(screen.getByRole('img', { name: /Pip is affectionate/ })).toBeInTheDocument();
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Pet Pip' }));
    const saved = JSON.parse(localStorage.getItem('civildesk.preview.v1')!);
    expect(saved.companion.state).not.toBe('affectionate');
    expect(saved.companion.experience).toBe(0);
  });
  it('celebrates a verified first completion with the achievement message, once', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Check culvert sizing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await screen.findByText('Check culvert sizing');
    expect(screen.queryByText('Achievement unlocked!')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Check culvert sizing' }));
    expect((await screen.findAllByText('Achievement unlocked!')).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Pip is celebrating/ })).toBeInTheDocument();
  });
  it('stays quiet when the engagement level is quiet', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(await screen.findByLabelText('Engagement level'), { target: { value: 'quiet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Quiet task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await screen.findByText('Quiet task');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Quiet task' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Complete Quiet task' })).toBeNull());
    expect(screen.queryByText('Achievement unlocked!')).toBeNull();
    expect(screen.queryByRole('img', { name: /Pip is celebrating/ })).toBeNull();
  });
  it('shows a still Pip, with its state still readable, under reduced motion', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Reduced motion/ }));
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(true);
    const art = screen.getByRole('img', { name: /Pip is/ });
    expect(art.getAttribute('class')).toContain('still');
  });
});
