import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

describe('first-run workspace', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('saves onboarding, navigation, and Pip visibility across remounts', async () => {
    const view = render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    expect(await screen.findByRole('heading', { name: /Alex/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pet Pip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Pip page' }));
    expect(await screen.findByText('Pip likes having you around.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pip' }));
    expect(await screen.findByText('Pip is taking a break')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Pip page' })).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('civildesk.preview.v1')!).preferences.pipVisible).toBe(false));
    view.unmount();
    render(<App/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Pip' }));
    expect(await screen.findByText('Pip is taking a break')).toBeInTheDocument();
  });

  it('shows a recoverable error when stored state cannot be read', async () => {
    localStorage.setItem('civildesk.preview.v1', '{invalid');
    render(<App/>);
    expect(await screen.findByText('CivilDesk could not open')).toBeInTheDocument();
    expect(screen.getByText('Error: Preview preferences could not be read.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('creates, edits, completes, reopens, and deletes a task through the workspace', async () => {
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Casey' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: /Casey/ });
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Review drainage drawing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByText('Review drainage drawing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Review drainage drawing' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter tasks' }), { target: { value: 'done' } });
    expect(await screen.findByRole('button', { name: 'Reopen Review drainage drawing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Review drainage drawing' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter tasks' }), { target: { value: 'open' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Review drainage drawing' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Review bridge drawing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByText('Review bridge drawing')).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Review bridge drawing' }));
    await waitFor(() => expect(screen.queryByText('Review bridge drawing')).not.toBeInTheDocument());
    confirm.mockRestore();
  });

  it('creates and removes an all-day calendar event', async () => {
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Jordan' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: /Jordan/ });
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Site visit' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'All-day event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByText('Site visit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Site visit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Updated site visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByText('Updated site visit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Updated site visit' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Updated site visit')).not.toBeInTheDocument());
    confirm.mockRestore();
  });

  async function enter(name: string) {
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: new RegExp(name) });
  }

  it('shows only intent-based navigation and keeps engineering reachable through its group', async () => {
    await enter('Sam');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const name of ['My Day', 'School', 'Personal', 'Calendar', 'Focus']) expect(within(nav).getByRole('button', { name: name })).toBeInTheDocument();
    for (const gone of ['Courses', 'Grades', 'Goals', 'Habits', 'Analytics']) expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    const toggle = within(nav).getByRole('button', { name: 'Engineering' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('button', { name: 'Challenges' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Projects', 'Challenges', 'Skills', 'Journal']) expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Challenges' }));
    expect(await screen.findByRole('heading', { name: 'Engineering Challenges' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Challenges' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Engineering')).toBeInTheDocument();
  });

  it('files tasks by area and shows today\'s tasks on My Day with a one-click completion', async () => {
    await enter('Riley');
    const today = new Date(); const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(screen.getByRole('combobox', { name: 'Area' })).toHaveValue('School');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Statics homework' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByText('Statics homework')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    expect(screen.queryByText('Statics homework')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    const today_ = await screen.findByRole('list', { name: 'Tasks for today' });
    expect(within(today_).getByText('Statics homework')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'What to focus on next' })).getByText('Statics homework')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Statics homework' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument());
    expect(screen.getByText(/1 of 1 done/)).toBeInTheDocument();
  });

  it('does not show engineering content on My Day when nothing engineering is active', async () => {
    await enter('Taylor');
    expect(screen.queryByText('Engineering challenge', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'In progress' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing queued')).toBeInTheDocument();
  });

  it('opens the Focus page with the suggested task selected', async () => {
    await enter('Quinn');
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Plan the week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await screen.findByText('Plan the week');
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start focus/ }));
    const select = await screen.findByRole('combobox', { name: 'Working on' });
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Plan the week');
  });

  it('gives quick access to Pip\'s wardrobe and achievements from the Pip page', async () => {
    await enter('Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Open Pip page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wardrobe' }));
    expect(await screen.findByRole('heading', { name: 'Wardrobe' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Achievements' }));
    expect(await screen.findByRole('heading', { name: 'Achievements' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Pip' })).toHaveAttribute('aria-current', 'page');
  });
});
