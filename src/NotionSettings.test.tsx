import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { NotionSettings } from './NotionSettings';
import * as notion from './services/notion';

vi.mock('./services/notion', async importOriginal => {
  const real = await importOriginal<typeof import('./services/notion')>();
  return { ...real, notionConnect: vi.fn(real.notionConnect), notionCheck: vi.fn(real.notionCheck), notionSearch: vi.fn(real.notionSearch), notionPageBlocks: vi.fn(real.notionPageBlocks), notionStatus: vi.fn(real.notionStatus) };
});
const { NotionError } = notion;
const TOKEN = 'ntn_frontend_test_token_123456';

beforeEach(() => { openWorkspace.mockClear(); notion.resetNotionPreview(); vi.mocked(notion.notionConnect).mockClear(); vi.mocked(notion.notionCheck).mockClear(); vi.mocked(notion.notionSearch).mockClear(); vi.mocked(notion.notionPageBlocks).mockClear(); });
afterEach(cleanup);

const openWorkspace = vi.fn();
async function connect() {
  render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
  fireEvent.change(await screen.findByLabelText('Connection token'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Connected');
}

describe('Notion settings: disconnected', () => {
  it('starts disconnected, explains the read-only scope and contacts nothing', async () => {
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/Read-only\./)).toBeInTheDocument();
    expect(screen.getByText(/works fully without Notion/)).toBeInTheDocument();
    expect(screen.getByText(/Windows Credential Manager/)).toBeInTheDocument();
    const input = screen.getByLabelText('Connection token') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(notion.notionCheck).not.toHaveBeenCalled();
    expect(notion.notionSearch).not.toHaveBeenCalled();
    expect(notion.notionConnect).not.toHaveBeenCalled();
  });

  it('is part of the Settings page without adding a sidebar item', async () => {
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Riley' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: /Riley/ });
    expect(screen.queryByRole('button', { name: 'Notion' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Notion' })).toBeInTheDocument();
    expect(notion.notionSearch).not.toHaveBeenCalled();
  });
});

describe('Notion settings: connection', () => {
  it('verifies, shows only non-secret facts and clears the token input', async () => {
    await connect();
    expect(screen.queryByLabelText('Connection token')).toBeNull();
    expect(screen.queryByDisplayValue(TOKEN)).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(screen.getByText('Browser preview (sample data)')).toBeInTheDocument();
    expect(screen.getByText('2026-03-11')).toBeInTheDocument();
    for (const name of ['Check connection', 'Open workspace', 'Disconnect', 'Replace token']) expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('shows an authentication failure and does not keep the rejected token', async () => {
    vi.mocked(notion.notionConnect).mockRejectedValueOnce(new NotionError('auth_failed', 'Notion didn’t accept the saved connection token.'));
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    const input = await screen.findByLabelText('Connection token') as HTMLInputElement;
    fireEvent.change(input, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('didn’t accept');
    expect(input.value).toBe('');
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('reports offline calmly and keeps the value so the user can retry', async () => {
    vi.mocked(notion.notionConnect).mockRejectedValueOnce(new NotionError('offline', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.'));
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    const input = await screen.findByLabelText('Connection token') as HTMLInputElement;
    fireEvent.change(input, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your CivilDesk data is unaffected');
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(input.value).toBe(TOKEN);
  });

  it('shows connecting while the request is pending', async () => {
    let release: (s: notion.ConnectionStatus) => void = () => undefined;
    vi.mocked(notion.notionConnect).mockImplementationOnce(() => new Promise(r => { release = r; }));
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    fireEvent.change(await screen.findByLabelText('Connection token'), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    release(await notion.notionStatus());
  });

  it('shows rate limiting during a check without losing the connection', async () => {
    await connect();
    vi.mocked(notion.notionCheck).mockRejectedValueOnce(new NotionError('rate_limited', 'Notion is limiting requests right now. Try again in about 30 seconds.', 30));
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText('Rate limited')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('30 seconds');
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeEnabled();
  });

  it('shows access restricted and authentication failed states from the backend', async () => {
    for (const [state, label] of [['restricted', 'Access restricted'], ['auth_failed', 'Authentication failed']] as const) {
      vi.mocked(notion.notionStatus).mockResolvedValueOnce({ state, workspaceName: 'Lab', botName: null, connectedAtMs: 1, lastVerifiedAtMs: 1, selectedCount: 0, readOnly: true, apiVersion: '2026-03-11', message: null });
      render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open workspace' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Replace token' })).toBeEnabled();
      cleanup();
    }
  });
});

describe('Notion settings: disconnect and accessibility', () => {
  it('requires confirmation, explains local-only removal and revocation, then clears state', async () => {
    await notion.notionConnect(TOKEN);
    await notion.notionSetSourceSelected('10000000-0000-0000-0000-000000000002', 'data_source', true);
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    expect(await screen.findByText('Assignments (sample)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/does not revoke the connection in Notion/)).toBeInTheDocument();
    expect(within(confirm).getByText(/notion\.so\/profile\/integrations/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep connected' }));
    expect(screen.getByText('Connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect and remove token' }));
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection token')).toBeInTheDocument();
    expect(screen.queryByText('Remembered sources', { selector: 'h3' })).toBeNull();
    expect((await notion.notionSelectedSources())).toHaveLength(0);
    await expect(notion.notionSearch('', 'all', null)).rejects.toMatchObject({ kind: 'not_connected' });
  });

  it('replaces the token through the same secure input', async () => {
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    const input = screen.getByLabelText('New connection token') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'ntn_replacement_token_99999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace and verify' }));
    await waitFor(() => expect(screen.queryByLabelText('New connection token')).toBeNull());
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('replacement_token');
  });

  it('remembers sources, lists them with a way to forget them, and opens the workspace instead of a dialog', async () => {
    await notion.notionConnect(TOKEN);
    await notion.notionSetSourceSelected('10000000-0000-0000-0000-000000000002', 'data_source', true);
    render(<NotionSettings onOpenWorkspace={openWorkspace}/>);
    expect(await screen.findByText('Assignments (sample)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(openWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop remembering Assignments (sample)' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Stop remembering/ })).toBeNull());
    expect(screen.getByText(/No sources remembered yet/)).toBeInTheDocument();
    expect(await notion.notionSelectedSources()).toHaveLength(0);
  });

  it('exposes labelled controls and a live status', async () => {
    await connect();
    expect(screen.getByRole('status')).toBeInTheDocument();
    for (const b of screen.getAllByRole('button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
  });
});
