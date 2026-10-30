import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

describe('first-run workspace', () => {
  beforeEach(() => localStorage.clear());

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
});
