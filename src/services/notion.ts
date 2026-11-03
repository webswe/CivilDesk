import { invoke } from '@tauri-apps/api/core';

/** Phase 5A: read-only Notion. Authenticated requests happen in the Rust backend; the frontend only sees sanitized results. */
export type NotionErrorKind = 'not_connected' | 'auth_failed' | 'restricted' | 'not_found' | 'rate_limited' | 'offline' | 'timeout' | 'tls' | 'unavailable' | 'invalid_request' | 'invalid_response' | 'cancelled' | 'storage';
export class NotionError extends Error {
  constructor(public kind: NotionErrorKind, message: string, public retryAfterSeconds: number | null = null) { super(message); }
}
export type ConnectionState = 'not_connected' | 'connected' | 'auth_failed' | 'restricted' | 'unavailable';
export interface ConnectionStatus { state: ConnectionState; workspaceName: string | null; botName: string | null; connectedAtMs: number | null; lastVerifiedAtMs: number | null; selectedCount: number; readOnly: boolean; apiVersion: string; message: string | null }
export type ResourceType = 'page' | 'data_source';
export interface ResourceSummary { id: string; resourceType: ResourceType; name: string; untitled: boolean; databaseId: string | null; lastEdited: string | null; icon: string | null }
export interface DiscoveryPage { items: ResourceSummary[]; nextCursor: string | null; hasMore: boolean; incomplete: boolean }
export interface DatabaseView { id: string; name: string; dataSources: { id: string; name: string }[] }
export interface PropertySchema { name: string; kind: string; options: string[]; supported: boolean }
export interface DataSourceView { id: string; name: string; untitled: boolean; databaseId: string | null; properties: PropertySchema[] }
export interface Cell { name: string; kind: string; text: string; tags: string[]; empty: boolean; supported: boolean }
export interface EntryRow { id: string; title: string; lastEdited: string | null; cells: Cell[] }
export interface EntriesPage { rows: EntryRow[]; nextCursor: string | null; hasMore: boolean; incomplete: boolean }
export interface PageView { id: string; title: string; untitled: boolean; created: string | null; lastEdited: string | null; parentKind: string; parentId: string | null; icon: string | null; properties: Cell[] }
export interface BlockView { id: string; kind: string; text: string; checked: boolean | null; language: string | null; hasChildren: boolean; supported: boolean; links: string[] }
export interface BlocksPage { blocks: BlockView[]; nextCursor: string | null; hasMore: boolean }
export interface SelectedSource { resourceId: string; resourceType: ResourceType; displayName: string; databaseId: string | null; selectedAtMs: number; lastVerifiedAtMs: number | null }
export type SearchKind = 'all' | 'page' | 'data_source';

const native = () => '__TAURI_INTERNALS__' in window;

function asNotionError(e: unknown): NotionError {
  if (e instanceof NotionError) return e;
  if (e && typeof e === 'object' && 'kind' in e && 'message' in e) {
    const o = e as { kind: NotionErrorKind; message: string; retryAfterSeconds?: number | null };
    return new NotionError(o.kind, String(o.message), o.retryAfterSeconds ?? null);
  }
  return new NotionError('unavailable', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.');
}
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); } catch (e) { throw asNotionError(e); }
}

// ------------------------------------------------------------------------------------------------
// Browser preview: a labelled, in-memory sample workspace. It never touches the network or a credential.
// ------------------------------------------------------------------------------------------------
const DB = '10000000-0000-0000-0000-000000000001';
const DS = '10000000-0000-0000-0000-000000000002';
const DS2 = '10000000-0000-0000-0000-000000000003';
const PG = '10000000-0000-0000-0000-000000000004';
const PG2 = '10000000-0000-0000-0000-000000000005';
const previewResources: ResourceSummary[] = [
  { id: DS, resourceType: 'data_source', name: 'Assignments (sample)', untitled: false, databaseId: DB, lastEdited: '2026-03-02T10:00:00.000Z', icon: null },
  { id: DS2, resourceType: 'data_source', name: 'Untitled data source', untitled: true, databaseId: DB, lastEdited: null, icon: null },
  { id: PG, resourceType: 'page', name: 'Study notes (sample)', untitled: false, databaseId: null, lastEdited: '2026-03-01T09:30:00.000Z', icon: '\u{1F4D8}' },
  { id: PG2, resourceType: 'page', name: 'Untitled page', untitled: true, databaseId: null, lastEdited: null, icon: null },
];
const previewChildPage = { id: '10000000-0000-0000-0000-000000000006', name: 'Lab notes (sample)' };
const previewSchema: PropertySchema[] = [
  { name: 'Name', kind: 'title', options: [], supported: true }, { name: 'Due', kind: 'date', options: [], supported: true },
  { name: 'Status', kind: 'status', options: ['Not started', 'In progress', 'Done'], supported: true }, { name: 'Course', kind: 'select', options: ['CE 201', 'CE 305'], supported: true },
  { name: 'Tags', kind: 'multi_select', options: ['Lab', 'Report'], supported: true }, { name: 'Hours', kind: 'rollup', options: [], supported: false },
];
const cell = (name: string, kind: string, text: string, tags: string[] = []): Cell => ({ name, kind, text, tags, empty: !text && !tags.length, supported: true });
const previewRows: EntryRow[] = Array.from({ length: 12 }, (_, i) => ({ id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, title: `Assignment ${i + 1} (sample)`, lastEdited: null, cells: [
  cell('Due', 'date', `2026-03-${String(i + 3).padStart(2, '0')}`), cell('Status', 'status', i % 3 === 0 ? 'Done' : 'In progress'), cell('Course', 'select', i % 2 ? 'CE 201' : 'CE 305'), cell('Tags', 'multi_select', '', i % 4 === 0 ? ['Lab'] : []),
  { name: 'Hours', kind: 'rollup', text: 'Unsupported property type (rollup)', tags: [], empty: false, supported: false }] }));
const bid = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const blk = (n: number, kind: string, text: string, extra: Partial<BlockView> = {}): BlockView => ({ id: bid(n), kind, text, checked: null, language: null, hasChildren: false, supported: true, links: [], ...extra });
const PG3 = '10000000-0000-0000-0000-000000000006';
const previewBlocks: BlockView[] = [
  blk(1, 'heading_1', 'Week 4 review'),
  blk(2, 'paragraph', 'Sample text from a Notion page. Content is shown as formatted text only.', { links: ['https://example.com/syllabus'] }),
  blk(3, 'heading_2', 'Reading list'),
  blk(4, 'bulleted_list_item', 'Soil classification', { hasChildren: true }),
  blk(5, 'bulleted_list_item', 'Retaining walls'),
  blk(6, 'numbered_list_item', 'Read chapter 4'),
  blk(7, 'numbered_list_item', 'Summarise the lab'),
  blk(8, 'to_do', 'Re-read soil classification chapter', { checked: false }),
  blk(9, 'to_do', 'Email the lab partner', { checked: true }),
  blk(10, 'quote', 'Measure twice, pour once.'),
  blk(11, 'divider', ''),
  blk(12, 'toggle', 'Formula sheet', { hasChildren: true }),
  { ...blk(13, 'child_page', 'Lab notes (sample)'), id: PG3 },
  blk(14, 'image', 'Attachment not downloaded: Site photo'),
  blk(15, 'table', 'Unsupported block (table)', { supported: false }),
];
const previewChildren: Record<string, BlockView[]> = {
  [bid(4)]: [blk(40, 'bulleted_list_item', 'USCS and AASHTO systems'), blk(41, 'paragraph', 'Plasticity index drives the split between silts and clays.')],
  [bid(12)]: [blk(120, 'paragraph', 'q = gamma x h'), blk(121, 'bulleted_list_item', 'Nested item', { hasChildren: true })],
  [bid(121)]: [blk(1210, 'paragraph', 'Third level')],
  [PG3]: [blk(130, 'paragraph', 'Notes from the Tuesday lab session.')],
};
const preview = { connected: false, workspace: 'Browser preview (sample data)', verifiedAt: null as number | null, selected: [] as SelectedSource[] };
const previewStatus = (): ConnectionStatus => ({ state: preview.connected ? 'connected' : 'not_connected', workspaceName: preview.connected ? preview.workspace : null, botName: preview.connected ? 'CivilDesk preview' : null, connectedAtMs: preview.verifiedAt, lastVerifiedAtMs: preview.verifiedAt, selectedCount: preview.connected ? preview.selected.length : 0, readOnly: true, apiVersion: '2026-03-11', message: preview.connected ? 'Sample data — the browser preview never contacts Notion.' : null });
const requireConnected = () => { if (!preview.connected) throw new NotionError('not_connected', 'Notion isn’t connected. Connect it in Settings to browse content.'); };
const pageOf = <T,>(all: T[], cursor: string | null, size: number) => { const start = cursor ? Number(cursor) : 0; const next = start + size; return { slice: all.slice(start, next), nextCursor: next < all.length ? String(next) : null }; };

export const notionStatus = async (): Promise<ConnectionStatus> => native() ? call('notion_status') : previewStatus();
export async function notionConnect(token: string): Promise<ConnectionStatus> {
  if (native()) return call('notion_connect', { token });
  if (token.trim().length < 10) throw new NotionError('invalid_request', 'That doesn’t look like a Notion connection token. Copy the internal connection secret from Notion and try again.');
  preview.connected = true; preview.verifiedAt = Date.now(); return previewStatus();
}
export async function notionCheck(): Promise<ConnectionStatus> { if (native()) return call('notion_check'); requireConnected(); preview.verifiedAt = Date.now(); return previewStatus(); }
export async function notionDisconnect(): Promise<ConnectionStatus> { if (native()) return call('notion_disconnect'); preview.connected = false; preview.verifiedAt = null; preview.selected = []; return previewStatus(); }
export const notionCancel = async (): Promise<void> => { if (native()) await invoke('notion_cancel').catch(() => undefined); };
export async function notionSearch(query: string, kind: SearchKind, cursor: string | null): Promise<DiscoveryPage> {
  if (native()) return call('notion_search', { query: query || null, kind: kind === 'all' ? null : kind, cursor });
  requireConnected();
  const q = query.trim().toLowerCase();
  const all = previewResources.filter(r => (kind === 'all' || r.resourceType === kind) && (!q || r.name.toLowerCase().includes(q)));
  const { slice, nextCursor } = pageOf(all, cursor, 3);
  return { items: slice, nextCursor, hasMore: nextCursor !== null, incomplete: false };
}
export async function notionOpenDatabase(id: string): Promise<DatabaseView> {
  if (native()) return call('notion_open_database', { id });
  requireConnected(); if (id !== DB) throw new NotionError('not_found', 'Notion couldn’t find that item. It may have been moved or deleted, or it hasn’t been shared with this connection.');
  return { id: DB, name: 'Coursework (sample)', dataSources: [{ id: DS, name: 'Assignments (sample)' }, { id: DS2, name: 'Untitled data source' }] };
}
export async function notionOpenDataSource(id: string): Promise<DataSourceView> {
  if (native()) return call('notion_open_data_source', { id });
  requireConnected(); const r = previewResources.find(x => x.id === id && x.resourceType === 'data_source');
  if (!r) throw new NotionError('not_found', 'Notion couldn’t find that item. It may have been moved or deleted, or it hasn’t been shared with this connection.');
  return { id, name: r.name, untitled: r.untitled, databaseId: r.databaseId, properties: id === DS ? previewSchema : previewSchema.slice(0, 1) };
}
export async function notionPreviewEntries(id: string, cursor: string | null): Promise<EntriesPage> {
  if (native()) return call('notion_preview_entries', { id, cursor });
  requireConnected(); const { slice, nextCursor } = pageOf(id === DS ? previewRows : [], cursor, 10);
  return { rows: slice, nextCursor, hasMore: nextCursor !== null, incomplete: false };
}
export async function notionOpenPage(id: string): Promise<PageView> {
  if (native()) return call('notion_open_page', { id });
  requireConnected();
  const row = previewRows.find(x => x.id === id);
  if (row) return { id, title: row.title, untitled: false, created: '2026-01-10T08:00:00.000Z', lastEdited: '2026-03-02T10:00:00.000Z', parentKind: 'data_source_id', parentId: DS, icon: null, properties: structuredClone(row.cells) };
  if (id === PG3) return { id, title: previewChildPage.name, untitled: false, created: '2026-01-11T08:00:00.000Z', lastEdited: '2026-03-01T09:30:00.000Z', parentKind: 'page_id', parentId: PG, icon: '\u{1F9EA}', properties: [] };
  const r = previewResources.find(x => x.id === id && x.resourceType === 'page');
  if (!r) throw new NotionError('not_found', 'Notion couldn’t find that item. It may have been moved or deleted, or it hasn’t been shared with this connection.');
  return { id, title: r.name, untitled: r.untitled, created: '2026-01-10T08:00:00.000Z', lastEdited: r.lastEdited, parentKind: 'workspace', parentId: null, icon: r.icon, properties: [] };
}
export async function notionPageBlocks(id: string, cursor: string | null): Promise<BlocksPage> {
  if (native()) return call('notion_page_blocks', { id, cursor });
  requireConnected();
  const source = id === PG ? previewBlocks : previewChildren[id] ?? (previewRows.some(r => r.id === id) ? [blk(200, 'paragraph', 'Notes for this entry.')] : []);
  const { slice, nextCursor } = pageOf(source, cursor, 50);
  return { blocks: slice, nextCursor, hasMore: nextCursor !== null };
}
const previewOpened: string[] = [];
/** Opens the item in Notion in the system browser. The backend builds the address from the identifier. */
export async function notionOpenInNotion(id: string): Promise<void> { if (native()) await call('notion_open_in_notion', { id }); else previewOpened.push(id); }
/** Opens a link from Notion text (https only; validated again in the backend) after the user chooses it. */
export async function notionOpenLink(url: string): Promise<void> { if (native()) await call('notion_open_link', { url }); else previewOpened.push(url); }
/** Test helper: what the browser preview was asked to open externally. */
export const notionPreviewOpened = () => [...previewOpened];
export async function notionSetSourceSelected(resourceId: string, resourceType: ResourceType, selected: boolean): Promise<SelectedSource[]> {
  if (native()) return call('notion_set_source_selected', { resourceId, resourceType, selected });
  requireConnected();
  const r = previewResources.find(x => x.id === resourceId);
  preview.selected = selected && r ? [...preview.selected.filter(s => s.resourceId !== resourceId), { resourceId, resourceType, displayName: r.name, databaseId: r.databaseId, selectedAtMs: Date.now(), lastVerifiedAtMs: Date.now() }] : preview.selected.filter(s => s.resourceId !== resourceId);
  return structuredClone(preview.selected);
}
export const notionSelectedSources = async (): Promise<SelectedSource[]> => native() ? call('notion_selected_sources') : structuredClone(preview.selected);
/** Test helper: resets the browser-preview sample workspace. */
export function resetNotionPreview() { previewOpened.length = 0; preview.connected = false; preview.verifiedAt = null; preview.selected = []; }
