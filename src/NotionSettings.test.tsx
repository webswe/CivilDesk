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

beforeEach(() => { notion.resetNotionPreview(); vi.mocked(notion.notionConnect).mockClear(); vi.mocked(notion.notionCheck).mockClear(); vi.mocked(notion.notionSearch).mockClear(); vi.mocked(notion.notionPageBlocks).mockClear(); });
afterEach(cleanup);

const dialog = () => screen.getByRole('dialog');
async function connect() {
  render(<NotionSettings/>);
  fireEvent.change(await screen.findByLabelText('Connection token'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Connected');
}
async function browse() {
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Browse content' }));
  await within(dialog()).findByText('Assignments (sample)');
}

describe('Notion settings: disconnected', () => {
  it('starts disconnected, explains the read-only scope and contacts nothing', async () => {
    render(<NotionSettings/>);
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
    for (const name of ['Check connection', 'Browse content', 'Disconnect', 'Replace token']) expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('shows an authentication failure and does not keep the rejected token', async () => {
    vi.mocked(notion.notionConnect).mockRejectedValueOnce(new NotionError('auth_failed', 'Notion didn’t accept the saved connection token.'));
    render(<NotionSettings/>);
    const input = await screen.findByLabelText('Connection token') as HTMLInputElement;
    fireEvent.change(input, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('didn’t accept');
    expect(input.value).toBe('');
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('reports offline calmly and keeps the value so the user can retry', async () => {
    vi.mocked(notion.notionConnect).mockRejectedValueOnce(new NotionError('offline', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.'));
    render(<NotionSettings/>);
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
    render(<NotionSettings/>);
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
    expect(screen.getByRole('button', { name: 'Browse content' })).toBeEnabled();
  });

  it('shows access restricted and authentication failed states from the backend', async () => {
    for (const [state, label] of [['restricted', 'Access restricted'], ['auth_failed', 'Authentication failed']] as const) {
      vi.mocked(notion.notionStatus).mockResolvedValueOnce({ state, workspaceName: 'Lab', botName: null, connectedAtMs: 1, lastVerifiedAtMs: 1, selectedCount: 0, readOnly: true, apiVersion: '2026-03-11', message: null });
      render(<NotionSettings/>);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Browse content' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Replace token' })).toBeEnabled();
      cleanup();
    }
  });
});

describe('Notion settings: discovery and selection', () => {
  it('lists pages and data sources distinctly, handles unnamed items and paginates without duplicates', async () => {
    await browse();
    const d = within(dialog());
    expect(d.getByRole('button', { name: /Assignments \(sample\)/ })).toHaveTextContent('Data source');
    expect(d.getByRole('button', { name: /Study notes \(sample\)/ })).toHaveTextContent('Page');
    expect(d.getByText('Untitled data source')).toBeInTheDocument();
    expect(d.queryByText('Untitled page')).toBeNull();
    fireEvent.click(d.getByRole('button', { name: 'Load more' }));
    await d.findByText('Untitled page');
    expect(d.getAllByRole('listitem')).toHaveLength(4);
    expect(d.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a loading state, then an empty state that explains sharing', async () => {
    await connect();
    let release: (p: notion.DiscoveryPage) => void = () => undefined;
    vi.mocked(notion.notionSearch).mockImplementationOnce(() => new Promise(r => { release = r; }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse content' }));
    expect(await within(dialog()).findByText(/Loading Notion content/)).toBeInTheDocument();
    release({ items: [], nextCursor: null, hasMore: false, incomplete: false });
    expect(await within(dialog()).findByText('Nothing found')).toBeInTheDocument();
    expect(within(dialog()).getByText(/shared with the connection/)).toBeInTheDocument();
  });

  it('searches by title', async () => {
    await browse();
    const d = within(dialog());
    fireEvent.change(d.getByLabelText('Search Notion titles'), { target: { value: 'study' } });
    fireEvent.click(d.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(d.queryByText('Assignments (sample)')).toBeNull());
    expect(d.getByText(/Study notes/)).toBeInTheDocument();
    fireEvent.change(d.getByLabelText('Search Notion titles'), { target: { value: 'zzz' } });
    fireEvent.click(d.getByRole('button', { name: 'Search' }));
    expect(await d.findByText('Nothing found')).toBeInTheDocument();
  });

  it('shows a data source schema and a paginated read-only entry preview, flagging unsupported properties', async () => {
    await browse();
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /Assignments \(sample\)/ }));
    await d.findByRole('heading', { name: 'Assignments (sample)' });
    expect(d.getByText(/preview unsupported/)).toBeInTheDocument();
    expect(await d.findByRole('table')).toBeInTheDocument();
    expect(d.getAllByText('Unsupported property type (rollup)').length).toBeGreaterThan(0);
    expect(d.getAllByRole('row')).toHaveLength(11);
    fireEvent.click(d.getByRole('button', { name: 'Load more entries' }));
    await waitFor(() => expect(d.getAllByRole('row')).toHaveLength(13));
    expect(d.getByRole('button', { name: 'View its database' })).toBeInTheDocument();
  });

  it('walks from a data source to its database and back to another data source', async () => {
    await browse();
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /Assignments \(sample\)/ }));
    fireEvent.click(await d.findByRole('button', { name: 'View its database' }));
    await d.findByRole('heading', { name: 'Coursework (sample)' });
    expect(d.getByText(/can contain several data sources/)).toBeInTheDocument();
    fireEvent.click(d.getByRole('button', { name: /Untitled data source/ }));
    await d.findByRole('heading', { name: 'Untitled data source' });
    expect(await d.findByText(/no entries visible/)).toBeInTheDocument();
  });

  it('remembers a source, shows it everywhere, and removes it again', async () => {
    await browse();
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /Assignments \(sample\)/ }));
    fireEvent.click(await d.findByRole('button', { name: 'Remember this source' }));
    expect(await d.findByRole('button', { name: /Remembered — remove/ })).toHaveAttribute('aria-pressed', 'true');
    expect(d.getByText(/Nothing is imported or synced/)).toBeInTheDocument();
    fireEvent.click(d.getByRole('button', { name: 'Back' }));
    expect(await d.findByRole('button', { name: /Assignments \(sample\)/ })).toHaveTextContent('Remembered');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    const settings = await screen.findByRole('button', { name: 'Stop remembering Assignments (sample)' });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Stop remembering/ })).toBeNull());
    expect(screen.getByText(/No sources remembered yet/)).toBeInTheDocument();
  });

  it('previews page content as plain text with graceful unsupported blocks', async () => {
    await browse();
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /Study notes/ }));
    await d.findByRole('heading', { name: /Study notes/ });
    expect(await d.findByText('Week 4 review')).toBeInTheDocument();
    expect(d.getByText('Attachment not downloaded: Site photo')).toBeInTheDocument();
    expect(d.getByText('Unsupported block (table)')).toBeInTheDocument();
    expect(d.getByRole('checkbox')).toBeDisabled();
    expect(dialog().querySelector('img, iframe, script, a, video, audio, embed, object')).toBeNull();
  });

  it('never interprets untrusted Notion text as HTML, links or resources', async () => {
    await browse();
    vi.mocked(notion.notionPageBlocks).mockResolvedValueOnce({ hasMore: false, nextCursor: null, blocks: [
      { id: '1', kind: 'paragraph', text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>', checked: null, language: null, hasChildren: false, supported: true },
      { id: '2', kind: 'bookmark', text: 'javascript:window.__pwned=3', checked: null, language: null, hasChildren: false, supported: true },
      { id: '3', kind: 'paragraph', text: '[click](https://evil.example)', checked: null, language: null, hasChildren: false, supported: true },
    ] });
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /Study notes/ }));
    expect(await d.findByText(/<img src=x/)).toBeInTheDocument();
    expect(dialog().querySelector('img, script, a, iframe')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(d.getByText('javascript:window.__pwned=3')).toBeInTheDocument();
  });

  it('shows a clear error when an item is not shared with the connection', async () => {
    await browse();
    vi.mocked(notion.notionSearch).mockResolvedValueOnce({ items: [{ id: '99999999-0000-0000-0000-000000000009', resourceType: 'page', name: 'Hidden', untitled: false, databaseId: null, lastEdited: null, icon: null }], nextCursor: null, hasMore: false, incomplete: false });
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: 'Search' }));
    fireEvent.click(await d.findByRole('button', { name: /Hidden/ }));
    expect(await d.findByRole('alert')).toHaveTextContent(/hasn’t been shared/);
  });
});

describe('Notion settings: disconnect and accessibility', () => {
  it('requires confirmation, explains local-only removal and revocation, then clears state', async () => {
    await browse();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Assignments/ }));
    fireEvent.click(await within(dialog()).findByRole('button', { name: 'Remember this source' }));
    await within(dialog()).findByRole('button', { name: /Remembered/ });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
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

  it('exposes labelled controls, a labelled dialog, live status and table captions', async () => {
    await browse();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('aria-label', 'Notion content');
    const d = within(dialog());
    expect(d.getByRole('search')).toBeInTheDocument();
    expect(d.getByLabelText('Show')).toBeInTheDocument();
    expect(d.getByRole('list', { name: 'Accessible Notion content' })).toBeInTheDocument();
    for (const b of d.getAllByRole('button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: /Assignments/ }));
    const table = await d.findByRole('table');
    expect(table.querySelector('caption')).toHaveTextContent(/Preview of entries/);
    expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(1);
  });
});
