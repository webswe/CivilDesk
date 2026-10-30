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
});
