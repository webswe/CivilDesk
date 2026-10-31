import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

describe('first-run workspace', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('saves onboarding, navigation, and Pip visibility across remounts', async () => {
    const view = render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    expect(await screen.findByText(/Good to have you here, Alex/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pet Pip' }));
    expect(await screen.findByText('Pip likes having you around.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pip' }));
    expect(await screen.findByText('Pip is taking a break')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('civildesk.preview.v1')!).preferences.pipVisible).toBe(false));
    view.unmount();
    render(<App/>);
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
    await screen.findByText(/Good to have you here, Casey/);
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
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
    await screen.findByText(/Good to have you here, Jordan/);
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
});
