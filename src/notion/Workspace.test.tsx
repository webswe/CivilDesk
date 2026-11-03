import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import * as notion from '../services/notion';
import { NotionWorkspace } from './Workspace';
import { resetWorkspaceSession } from './session';

vi.mock('../services/notion', async importOriginal => {
  const real = await importOriginal<typeof import('../services/notion')>();
  return { ...real, notionSearch: vi.fn(real.notionSearch), notionPageBlocks: vi.fn(real.notionPageBlocks), notionOpenPage: vi.fn(real.notionOpenPage), notionOpenDatabase: vi.fn(real.notionOpenDatabase), notionCheck: vi.fn(real.notionCheck), notionPreviewEntries: vi.fn(real.notionPreviewEntries) };
});
const { NotionError } = notion;
const TOKEN = 'ntn_frontend_test_token_123456';
const DS = '10000000-0000-0000-0000-000000000002'; const PG = '10000000-0000-0000-0000-000000000004'; const DB = '10000000-0000-0000-0000-000000000001';
configure({ asyncUtilTimeout: 4000 });
const onBack = vi.fn();
const setWidth = (w: number) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: w }); act(() => { window.dispatchEvent(new Event('resize')); }); };

beforeEach(() => { notion.resetNotionPreview(); resetWorkspaceSession(); onBack.mockClear(); setWidth(1280); for (const f of [notion.notionSearch, notion.notionPageBlocks, notion.notionOpenPage, notion.notionOpenDatabase, notion.notionCheck, notion.notionPreviewEntries]) vi.mocked(f).mockReset(); });
afterEach(cleanup);

const sidebar = () => within(screen.getByRole('complementary', { name: 'Notion navigation' }));
const content = () => within(screen.getByRole('main', { name: 'Notion content' }));
const ready = () => screen.findByRole('main', { name: 'Notion content' });
async function start() {
  await notion.notionConnect(TOKEN);
  const view = render(<NotionWorkspace onBack={onBack}/>);
  await ready();
  await sidebar().findByRole('button', { name: /Assignments \(sample\)/ });
  return view;
}
const openPage = async () => { fireEvent.click(within(sidebar().getByRole('list', { name: 'Shared pages' })).getByRole('button', { name: 'Study notes (sample)' })); await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' }); };
const openTable = async () => { fireEvent.click(within(sidebar().getByRole('list', { name: 'Shared databases' })).getByRole('button', { name: 'Assignments (sample)' })); await content().findByRole('table'); };

describe('workspace: landing and connection', () => {
  it('opens inside the main area with identity, search, saved sources and shared items, and contacts Notion only once', async () => {
    await start();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sidebar().getByText('Browser preview (sample data)')).toBeInTheDocument();
    expect(sidebar().getByText('Connected')).toBeInTheDocument();
    expect(sidebar().getByRole('search')).toBeInTheDocument();
    expect(sidebar().getByRole('heading', { name: /Saved sources/ })).toBeInTheDocument();
    expect(sidebar().getByText(/None yet/)).toBeInTheDocument();
    expect(sidebar().getByRole('heading', { name: 'Shared with CivilDesk' })).toBeInTheDocument();
    expect(content().getByRole('heading', { level: 1, name: 'Notion' })).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(notion.notionSearch).toHaveBeenCalledTimes(1);
  });

  it('explains a missing connection and routes back to Settings', async () => {
    render(<NotionWorkspace onBack={onBack}/>);
    expect(await screen.findByText('Notion isn’t connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to Settings/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(notion.notionSearch).not.toHaveBeenCalled();
  });

  it('has a Settings route back from a connected workspace', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('is reached from Settings as a page, not a dialog, and returns to Settings', async () => {
    await notion.notionConnect(TOKEN);
    render(<App/>);
    fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Riley' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
    await screen.findByRole('heading', { name: /Riley/ });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    expect(await screen.findByRole('complementary', { name: 'Notion navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Notion workspace' })).getByRole('button', { name: /Settings/ }));
    expect(await screen.findByRole('heading', { name: 'Notion' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull();
  });
});

describe('workspace: sidebar', () => {
  it('lists pages and databases separately, paginates without duplicates and never implies nesting for search results', async () => {
    await start();
    expect(sidebar().getByRole('list', { name: 'Shared pages' })).toBeInTheDocument();
    expect(sidebar().getByRole('list', { name: 'Shared databases' })).toBeInTheDocument();
    expect(sidebar().queryByText('Untitled page')).toBeNull();
    fireEvent.click(sidebar().getByRole('button', { name: 'Load more' }));
    await sidebar().findByText('Untitled page');
    expect(sidebar().queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(sidebar().getAllByText('Study notes (sample)')).toHaveLength(1);
    // Databases cannot be expanded here: their rows live in the table, and no ancestry is invented.
    expect(sidebar().queryByRole('button', { name: /Expand Assignments/ })).toBeNull();
  });

  it('expands a page to its real sub-pages only, and collapses again', async () => {
    await start();
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Study notes (sample)' }));
    expect(await sidebar().findByRole('button', { name: 'Lab notes (sample)' })).toBeInTheDocument();
    expect(sidebar().queryByText('Retaining walls')).toBeNull();
    fireEvent.click(sidebar().getByRole('button', { name: 'Collapse Study notes (sample)' }));
    expect(sidebar().queryByRole('button', { name: 'Lab notes (sample)' })).toBeNull();
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Study notes (sample)' }));
    expect(await sidebar().findByRole('button', { name: 'Lab notes (sample)' })).toBeInTheDocument();
    expect(vi.mocked(notion.notionPageBlocks).mock.calls.filter(c => c[0] === PG)).toHaveLength(1);
  });

  it('says so when an expanded page has no sub-pages', async () => {
    await start();
    fireEvent.click(sidebar().getByRole('button', { name: 'Load more' }));
    fireEvent.click(await sidebar().findByRole('button', { name: 'Expand Untitled page' }));
    expect(await sidebar().findByText('No sub-pages')).toBeInTheDocument();
  });

  it('keeps recent items for the session and highlights the open one', async () => {
    await start();
    await openPage();
    await openTable();
    const recent = sidebar().getByRole('list', { name: 'Recently opened' });
    expect([...recent.querySelectorAll('.nw-nav-name')].map(b => b.textContent)).toEqual(['Assignments (sample)', 'Study notes (sample)']);
    expect(within(recent).getByRole('button', { name: /Assignments/ })).toHaveAttribute('aria-current', 'page');
  });

  it('can be hidden and shown, and resized with the keyboard', async () => {
    await start();
    const handle = screen.getByRole('separator', { name: 'Resize navigation' });
    const before = Number(handle.getAttribute('aria-valuenow'));
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(before + 20);
    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(await screen.findByRole('complementary', { name: 'Notion navigation' })).toBeInTheDocument();
  });
});

describe('workspace: search', () => {
  it('searches titles in the sidebar, filters by type, paginates and clears back to the lists', async () => {
    await start();
    const calls = () => vi.mocked(notion.notionSearch).mock.calls.length;
    fireEvent.change(sidebar().getByLabelText('Search Notion titles'), { target: { value: 'study' } });
    fireEvent.submit(sidebar().getByRole('search'));
    expect(await sidebar().findByRole('heading', { name: /Results for/ })).toHaveTextContent('study');
    await waitFor(() => expect(sidebar().getByRole('list', { name: 'Search results' })).toHaveTextContent('Study notes'));
    expect(sidebar().queryByText('Shared with CivilDesk')).toBeNull();
    expect(vi.mocked(notion.notionSearch)).toHaveBeenLastCalledWith('study', 'all', null);
    fireEvent.change(sidebar().getByLabelText('Show'), { target: { value: 'data_source' } });
    await waitFor(() => expect(vi.mocked(notion.notionSearch)).toHaveBeenLastCalledWith('study', 'data_source', null));
    expect(await sidebar().findByText(/Nothing found/)).toBeInTheDocument();
    fireEvent.click(sidebar().getByRole('button', { name: 'Clear' }));
    expect(await sidebar().findByRole('heading', { name: 'Shared with CivilDesk' })).toBeInTheDocument();
    expect(calls()).toBe(3);
  });

  it('shows a loading state, paginates results and does not search again when a result is opened', async () => {
    await start();
    let release: (p: notion.DiscoveryPage) => void = () => undefined;
    vi.mocked(notion.notionSearch).mockImplementationOnce(() => new Promise(r => { release = r; }));
    fireEvent.change(sidebar().getByLabelText('Search Notion titles'), { target: { value: 'a' } });
    fireEvent.submit(sidebar().getByRole('search'));
    expect(await sidebar().findByText(/Searching/)).toBeInTheDocument();
    release({ items: [{ id: PG, resourceType: 'page', name: 'Study notes (sample)', untitled: false, databaseId: null, lastEdited: null, icon: null }], nextCursor: 'c2', hasMore: true, incomplete: true });
    fireEvent.click(await sidebar().findByRole('button', { name: 'Study notes (sample)' }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    expect(sidebar().getByText(/may be incomplete/)).toBeInTheDocument();
    expect(sidebar().getByRole('button', { name: 'Load more results' })).toBeInTheDocument();
    expect(vi.mocked(notion.notionSearch)).toHaveBeenCalledTimes(2);
  });
});

describe('workspace: pages as documents', () => {
  it('renders headings, lists, numbering, checkboxes, quotes, dividers and links as a document', async () => {
    await start(); await openPage();
    const c = content();
    expect(await c.findByRole('heading', { level: 2, name: 'Week 4 review' })).toBeInTheDocument();
    expect(c.getByRole('heading', { level: 3, name: 'Reading list' })).toBeInTheDocument();
    expect(c.getByText('Soil classification')).toBeInTheDocument();
    expect(c.getByText('Read chapter 4').closest('.nw-li')).toHaveTextContent('1.');
    expect(c.getByText('Summarise the lab').closest('.nw-li')).toHaveTextContent('2.');
    const boxes = c.getAllByRole('checkbox'); expect(boxes).toHaveLength(2);
    expect(boxes.every(b => (b as HTMLInputElement).disabled)).toBe(true);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false); expect((boxes[1] as HTMLInputElement).checked).toBe(true);
    expect(c.getByText('Measure twice, pour once.').tagName).toBe('BLOCKQUOTE');
    expect(document.querySelector('.nw-divider')).not.toBeNull();
    expect(c.getByRole('button', { name: 'Open link example.com' })).toBeInTheDocument();
  });

  it('shows breadcrumbs, the page icon fallback, an edited date, and no raw identifiers', async () => {
    await start(); await openPage();
    const crumbs = content().getByRole('navigation', { name: 'Notion breadcrumb' });
    await within(crumbs).findByText('Workspace');
    expect(within(crumbs).getByText('Study notes (sample)')).toHaveAttribute('aria-current', 'page');
    expect(content().getByText(/^Edited Mar 1, 2026/)).toBeInTheDocument();
    expect(document.querySelector('.nw-doc-head .nw-icon-tile')?.textContent).toBe('📘');
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('loads nested content on request, level by level, and stops at the depth limit', async () => {
    await start(); await openPage();
    const calls = () => vi.mocked(notion.notionPageBlocks).mock.calls.map(c => c[0]);
    expect(calls().filter(id => id !== PG)).toHaveLength(0);
    fireEvent.click(await content().findByRole('button', { name: /Show nested content of Soil classification/ }));
    expect(await content().findByText('USCS and AASHTO systems')).toBeInTheDocument();
    fireEvent.click(content().getByRole('button', { name: /Show nested content of Formula sheet/ }));
    fireEvent.click(await content().findByRole('button', { name: /Show nested content of Nested item/ }));
    expect(await content().findByText('Third level')).toBeInTheDocument();
    fireEvent.click(content().getByRole('button', { name: /Hide nested content of Soil classification/ }));
    expect(content().queryByText('USCS and AASHTO systems')).toBeNull();
    expect(calls().length).toBe(4);
  });

  it('represents attachments and unsupported blocks honestly and offers Open in Notion', async () => {
    await start(); await openPage();
    expect(await content().findByText('Attachment not downloaded: Site photo')).toBeInTheDocument();
    expect(content().getByText(/can’t be shown in CivilDesk \(table\)/)).toBeInTheDocument();
    expect(content().getAllByRole('button', { name: 'Open this page in Notion' }).length).toBeGreaterThanOrEqual(2);
    expect(content().queryByRole('img')).toBeNull();
    fireEvent.click(content().getAllByRole('button', { name: 'Open this page in Notion' })[0]!);
    await waitFor(() => expect(notion.notionPreviewOpened()).toContain(PG));
  });

  it('opens page links in the browser only on click, and only https', async () => {
    await start();
    vi.mocked(notion.notionPageBlocks).mockResolvedValueOnce({ hasMore: false, nextCursor: null, blocks: [
      { id: '1', kind: 'paragraph', text: 'Docs', checked: null, language: null, hasChildren: false, supported: true, links: ['https://example.com/a', 'javascript:alert(1)', 'http://insecure.example'] },
      { id: '2', kind: 'bookmark', text: 'javascript:window.__pwned=3', checked: null, language: null, hasChildren: false, supported: true, links: [] },
    ] });
    await openPage();
    expect(await content().findAllByRole('button', { name: /Open link/ })).toHaveLength(1);
    expect(notion.notionPreviewOpened()).toEqual([]);
    fireEvent.click(content().getByRole('button', { name: 'Open link example.com' }));
    await waitFor(() => expect(notion.notionPreviewOpened()).toEqual(['https://example.com/a']));
    expect(content().getByText('javascript:window.__pwned=3')).toBeInTheDocument();
  });

  it('never interprets untrusted Notion text as HTML, anchors or resources', async () => {
    await start();
    vi.mocked(notion.notionPageBlocks).mockResolvedValueOnce({ hasMore: false, nextCursor: null, blocks: [
      { id: '1', kind: 'paragraph', text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>', checked: null, language: null, hasChildren: false, supported: true, links: [] },
      { id: '3', kind: 'paragraph', text: '[click](https://evil.example)', checked: null, language: null, hasChildren: false, supported: true, links: [] },
    ] });
    await openPage();
    expect(await content().findByText(/<img src=x/)).toBeInTheDocument();
    expect(screen.getByRole('main').querySelector('img, script, a, iframe, object, embed, video, audio')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('opens a sub-page from a page, shows its real parent in the breadcrumb, and moves through history', async () => {
    await start(); await openPage();
    fireEvent.click(await content().findByRole('button', { name: /Lab notes \(sample\)/ }));
    await content().findByRole('heading', { level: 1, name: 'Lab notes (sample)' });
    const crumbs = content().getByRole('navigation', { name: 'Notion breadcrumb' });
    fireEvent.click(await within(crumbs).findByRole('button', { name: /Study notes \(sample\)/ }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await content().findByRole('heading', { level: 1, name: 'Lab notes (sample)' });
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it('marks an unreadable parent as inaccessible instead of inventing an ancestry', async () => {
    await start();
    vi.mocked(notion.notionOpenPage).mockImplementation(async id => id === PG ? { id, title: 'Orphan', untitled: false, created: null, lastEdited: null, parentKind: 'page_id', parentId: '99999999-0000-0000-0000-000000000001', icon: null, properties: [] } : Promise.reject(new NotionError('not_found', 'Notion couldn’t find that item.')));
    await act(async () => { fireEvent.click(within(sidebar().getByRole('list', { name: 'Shared pages' })).getByRole('button', { name: 'Study notes (sample)' })); });
    const crumbs = await content().findByRole('navigation', { name: 'Notion breadcrumb' });
    expect(await within(crumbs).findByText('Inaccessible parent')).toBeInTheDocument();
    expect(within(crumbs).queryByRole('button')).toBeNull();
    vi.mocked(notion.notionOpenPage).mockRestore();
  });
});

describe('workspace: databases as tables', () => {
  it('shows a read-only table with readable headings, badges, tags, checks, dates and honest unsupported columns', async () => {
    await start(); await openTable();
    const table = content().getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Due', 'Status', 'Course', 'Tags', 'Hours']);
    expect(table.querySelector('caption')).toHaveTextContent(/Select a row to open it as a page/);
    expect(within(table).getAllByText('Mar 3, 2026').length).toBeGreaterThan(0);
    expect(table.textContent).not.toMatch(/2026-03-0\d/);
    expect(table.querySelectorAll('.nw-status').length).toBe(10);
    expect(table.querySelectorAll('.nw-tag').length).toBeGreaterThan(10);
    expect(within(table).getAllByText('Not supported').length).toBe(10);
    expect(within(table).getAllByText('Empty').length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('row')).toHaveLength(11);
  });

  it('keeps the property schema out of the way behind a Properties control', async () => {
    await start(); await openTable();
    const details = document.querySelector('details.nw-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Properties (6)')).toBeInTheDocument();
    expect(details).toHaveTextContent(/Rollup \(not shown\)/);
  });

  it('paginates entries and reports what is loaded', async () => {
    await start(); await openTable();
    expect(content().getByText(/10\+ entries/)).toBeInTheDocument();
    fireEvent.click(content().getByRole('button', { name: 'Load more entries' }));
    await waitFor(() => expect(within(content().getByRole('table')).getAllByRole('row')).toHaveLength(13));
    expect(content().queryByRole('button', { name: 'Load more entries' })).toBeNull();
    expect(content().getByText(/12 entries/)).toBeInTheDocument();
  });

  it('opens a row as a page with its properties, breadcrumbs back to the table, and returns without searching again', async () => {
    await start(); await openTable();
    const searches = vi.mocked(notion.notionSearch).mock.calls.length;
    fireEvent.click(content().getByRole('button', { name: 'Assignment 2 (sample)' }));
    await content().findByRole('heading', { level: 1, name: 'Assignment 2 (sample)' });
    const dl = document.querySelector('dl.nw-props')!;
    expect(dl).toHaveTextContent('Status'); expect(dl).toHaveTextContent('In progress'); expect(dl).toHaveTextContent('Mar 4, 2026'); expect(dl).toHaveTextContent('Not supported');
    const crumbs = content().getByRole('navigation', { name: 'Notion breadcrumb' });
    await within(crumbs).findByRole('button', { name: 'Assignments (sample)' });
    expect(within(crumbs).getByRole('button', { name: 'Coursework (sample)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await content().findByRole('table');
    expect(vi.mocked(notion.notionSearch).mock.calls.length).toBe(searches);
  });

  it('opens a row by clicking anywhere on it', async () => {
    await start(); await openTable();
    const row = within(content().getByRole('table')).getAllByRole('row')[1]!;
    fireEvent.click(within(row).getAllByRole('cell')[0]!);
    await content().findByRole('heading', { level: 1, name: 'Assignment 1 (sample)' });
  });

  it('lists the data sources of a database with several, and shows the empty state for one without entries', async () => {
    await start(); await openTable();
    const crumbs = content().getByRole('navigation', { name: 'Notion breadcrumb' });
    fireEvent.click(await within(crumbs).findByRole('button', { name: 'Coursework (sample)' }));
    await content().findByRole('heading', { level: 1, name: 'Coursework (sample)' });
    expect(content().getByText(/several data sources/)).toBeInTheDocument();
    fireEvent.click(content().getByRole('button', { name: 'Untitled data source' }));
    expect(await content().findByText('No entries')).toBeInTheDocument();
  });

  it('goes straight to the table when a database has a single data source, without trapping Back', async () => {
    await start();
    vi.mocked(notion.notionOpenDatabase).mockResolvedValue({ id: DB, name: 'Coursework (sample)', dataSources: [{ id: DS, name: 'Assignments (sample)' }] });
    vi.mocked(notion.notionPageBlocks).mockResolvedValueOnce({ hasMore: false, nextCursor: null, blocks: [{ id: DB, kind: 'child_database', text: 'Inline database', checked: null, language: null, hasChildren: false, supported: true, links: [] }] });
    await openPage();
    fireEvent.click(await content().findByRole('button', { name: 'Inline database' }));
    expect(await content().findByRole('table')).toBeInTheDocument();
    expect(content().getByRole('heading', { level: 1, name: 'Assignments (sample)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    vi.mocked(notion.notionOpenDatabase).mockReset();
  });

  it('has a loading state and a calm retryable error for entries', async () => {
    await start();
    vi.mocked(notion.notionPreviewEntries).mockRejectedValueOnce(new NotionError('rate_limited', 'Notion is limiting requests right now. Try again in about 30 seconds.', 30));
    fireEvent.click(within(sidebar().getByRole('list', { name: 'Shared databases' })).getByRole('button', { name: 'Assignments (sample)' }));
    expect(await content().findByRole('alert')).toHaveTextContent('30 seconds');
    fireEvent.click(content().getByRole('button', { name: 'Retry' }));
    expect(await content().findByRole('table')).toBeInTheDocument();
  });
});

describe('workspace: saved sources and session', () => {
  it('remembers and forgets a source, reflecting it in the sidebar without a new search and without importing anything', async () => {
    await start(); await openTable();
    const searches = vi.mocked(notion.notionSearch).mock.calls.length;
    fireEvent.click(content().getByRole('button', { name: 'Remember source' }));
    expect(await content().findByRole('button', { name: /Remembered — remove/ })).toHaveAttribute('aria-pressed', 'true');
    const saved = sidebar().getByRole('list', { name: 'Saved sources' });
    expect(within(saved).getByRole('button', { name: /Assignments/ })).toBeInTheDocument();
    expect(await notion.notionSelectedSources()).toHaveLength(1);
    fireEvent.click(content().getByRole('button', { name: /Remembered — remove/ }));
    await waitFor(() => expect(sidebar().getByText(/None yet/)).toBeInTheDocument());
    expect(vi.mocked(notion.notionSearch).mock.calls.length).toBe(searches);
  });

  it('opens a saved source from the landing screen and the sidebar', async () => {
    await notion.notionConnect(TOKEN); await notion.notionSetSourceSelected(PG, 'page', true);
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    fireEvent.click(await content().findByRole('button', { name: 'Study notes (sample)' }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    expect(sidebar().getByRole('list', { name: 'Saved sources' })).toHaveTextContent('Study notes (sample)');
  });

  it('restores the last open resource and the loaded lists when returning in the same session', async () => {
    const first = await start(); await openPage();
    first.unmount();
    vi.mocked(notion.notionSearch).mockClear();
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    expect(notion.notionSearch).not.toHaveBeenCalled();
    expect(sidebar().getByRole('list', { name: 'Recently opened' })).toHaveTextContent('Study notes');
  });

  it('starts clean after the connection is disconnected and reconnected', async () => {
    const first = await start(); await openPage();
    first.unmount();
    await notion.notionDisconnect(); await notion.notionConnect(TOKEN);
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    expect(await content().findByRole('heading', { level: 1, name: 'Notion' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Recently opened' })).toBeNull();
  });
});

describe('workspace: errors and offline', () => {
  it('shows a not-shared error with a clear message', async () => {
    await start();
    vi.mocked(notion.notionSearch).mockResolvedValueOnce({ items: [{ id: '99999999-0000-0000-0000-000000000009', resourceType: 'page', name: 'Hidden', untitled: false, databaseId: null, lastEdited: null, icon: null }], nextCursor: null, hasMore: false, incomplete: false });
    fireEvent.change(sidebar().getByLabelText('Search Notion titles'), { target: { value: 'hid' } });
    fireEvent.submit(sidebar().getByRole('search'));
    fireEvent.click(await sidebar().findByRole('button', { name: 'Hidden' }));
    expect(await content().findByRole('alert')).toHaveTextContent(/hasn’t been shared/);
  });

  it('keeps loaded content visible when offline, explains it, and recovers on Try again', async () => {
    await start(); await openPage();
    await content().findByRole('heading', { level: 2, name: 'Week 4 review' });
    vi.mocked(notion.notionPageBlocks).mockRejectedValueOnce(new NotionError('offline', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.'));
    fireEvent.click(await content().findByRole('button', { name: /Show nested content of Soil classification/ }));
    expect(await content().findByText(/CivilDesk can’t reach Notion right now/)).toBeInTheDocument();
    expect(sidebar().getByText('Offline')).toBeInTheDocument();
    expect(content().getByRole('heading', { level: 2, name: 'Week 4 review' })).toBeInTheDocument();
    fireEvent.click(content().getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(content().queryByText(/can’t reach Notion right now/)).toBeNull());
    expect(sidebar().getByText('Connected')).toBeInTheDocument();
  });

  it('offers Retry for a failed sidebar list', async () => {
    await notion.notionConnect(TOKEN);
    vi.mocked(notion.notionSearch).mockRejectedValueOnce(new NotionError('unavailable', 'Notion is having trouble right now.'));
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    expect(await sidebar().findByText('Notion is having trouble right now.')).toBeInTheDocument();
    fireEvent.click(sidebar().getByRole('button', { name: 'Retry' }));
    expect(await sidebar().findByRole('button', { name: /Assignments/ })).toBeInTheDocument();
  });

  it('refreshes the connection state when Notion rejects the token', async () => {
    await start();
    vi.mocked(notion.notionPageBlocks).mockRejectedValueOnce(new NotionError('auth_failed', 'Notion didn’t accept the saved connection token.'));
    await act(async () => { fireEvent.click(within(sidebar().getByRole('list', { name: 'Shared pages' })).getByRole('button', { name: 'Study notes (sample)' })); });
    expect(await content().findByRole('alert')).toHaveTextContent('didn’t accept');
  });
});

describe('workspace: narrow windows', () => {
  it('collapses navigation into a drawer that opens from the toolbar, closes on selection and on Escape', async () => {
    await notion.notionConnect(TOKEN); setWidth(800);
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    await content().findByRole('heading', { level: 1, name: 'Notion' });
    expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(content().getByRole('button', { name: 'Browse pages and databases' }));
    fireEvent.click(await sidebar().findByRole('button', { name: 'Study notes (sample)' }));
    await content().findByRole('heading', { level: 1, name: 'Study notes (sample)' });
    expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(await screen.findByRole('complementary', { name: 'Notion navigation' })).toBeInTheDocument();
    expect(sidebar().getByRole('button', { name: 'Close navigation' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Notion navigation' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull();
  });

  it('closes an open drawer when the window narrows and reopens the sidebar when it widens', async () => {
    await start();
    expect(screen.getByRole('separator', { name: 'Resize navigation' })).toBeInTheDocument();
    setWidth(700);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Notion navigation' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(await screen.findByRole('complementary', { name: 'Notion navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).toBeNull();
    setWidth(1600);
    expect(await screen.findByRole('separator', { name: 'Resize navigation' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Notion navigation' })).toBeInTheDocument();
  });

  it('keeps the table inside its own focusable scroll area at the smallest supported width', async () => {
    await notion.notionConnect(TOKEN); setWidth(700);
    render(<NotionWorkspace onBack={onBack}/>);
    await ready();
    fireEvent.click(await content().findByRole('button', { name: 'Browse pages and databases' }));
    fireEvent.click(await sidebar().findByRole('button', { name: /Assignments \(sample\)/ }));
    const table = await content().findByRole('table');
    const wrap = table.closest('.nw-table-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('main').contains(wrap)).toBe(true);
  });
});

describe('workspace: accessibility', () => {
  it('labels regions, controls and the table, and exposes live status', async () => {
    await start(); await openTable();
    expect(screen.getByRole('toolbar', { name: 'Notion workspace' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Notion breadcrumb' })).toBeInTheDocument();
    expect(content().getByLabelText(/scrollable/)).toHaveAttribute('tabindex', '0');
    for (const b of screen.getAllByRole('button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
    expect(sidebar().getAllByRole('status').length).toBeGreaterThan(0);
  });
});
