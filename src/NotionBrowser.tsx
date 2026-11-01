import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Database, FileText, Search } from 'lucide-react';
import { NotionError, notionCancel, notionOpenDataSource, notionOpenDatabase, notionOpenPage, notionPageBlocks, notionPreviewEntries, notionSearch, notionSetSourceSelected, type BlockView, type Cell, type DataSourceView, type DatabaseView, type EntryRow, type PageView, type ResourceSummary, type ResourceType, type SearchKind, type SelectedSource } from './services/notion';

/** Everything below renders Notion content as React text nodes only: no HTML, no links, no remote images or embeds. */
type View = { t: 'list' } | { t: 'ds'; id: string } | { t: 'db'; id: string } | { t: 'page'; id: string };
const typeLabel = (t: ResourceType) => t === 'page' ? 'Page' : 'Data source';
const mergeById = <T extends { id: string }>(a: T[], b: T[]) => { const seen = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => !seen.has(x.id))]; };

function Problem({ error }: { error: NotionError | null }) {
  if (!error) return null;
  return <p className="notion-problem" role="alert">{error.message}</p>;
}
function Tags({ cell }: { cell: Cell }) {
  if (!cell.supported) return <span className="notion-unsupported">{cell.text}</span>;
  if (cell.tags.length) return <>{cell.tags.map(t => <span key={t} className="notion-tag">{t}</span>)}</>;
  return cell.empty ? <span className="notion-empty" aria-label="No value">{'—'}</span> : <>{cell.text}</>;
}

export function NotionBrowser({ sources, onSources, onError }: { sources: SelectedSource[]; onSources: (s: SelectedSource[]) => void; onError: (e: NotionError) => void }) {
  const [stack, setStack] = useState<View[]>([{ t: 'list' }]);
  const view = stack[stack.length - 1]!;
  const push = (v: View) => setStack(s => [...s, v]);
  const back = () => setStack(s => s.length > 1 ? s.slice(0, -1) : s);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; void notionCancel(); }; }, []);
  const selected = new Set(sources.map(s => s.resourceId));
  const fail = useCallback((e: unknown, set: (e: NotionError) => void) => {
    if (!alive.current) return;
    const err = e instanceof NotionError ? e : new NotionError('unavailable', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.');
    if (err.kind === 'cancelled') return;
    set(err); if (err.kind === 'auth_failed' || err.kind === 'not_connected') onError(err);
  }, [onError]);
  return <div className="notion-browser">
    {view.t !== 'list' && <button className="soft-button notion-back" onClick={back}><ArrowLeft size={14} aria-hidden="true"/> Back</button>}
    {view.t === 'list' && <ResourceList selected={selected} open={r => push(r.resourceType === 'page' ? { t: 'page', id: r.id } : { t: 'ds', id: r.id })} fail={fail} alive={alive}/>}
    {view.t === 'ds' && <DataSourceDetail key={view.id} id={view.id} selected={selected.has(view.id)} onSources={onSources} openDatabase={id => push({ t: 'db', id })} fail={fail} alive={alive}/>}
    {view.t === 'db' && <DatabaseDetail key={view.id} id={view.id} open={id => push({ t: 'ds', id })} fail={fail} alive={alive}/>}
    {view.t === 'page' && <PageDetail key={view.id} id={view.id} selected={selected.has(view.id)} onSources={onSources} fail={fail} alive={alive}/>}
  </div>;
}

type Common = { fail: (e: unknown, set: (e: NotionError) => void) => void; alive: React.RefObject<boolean> };

function ResourceList({ selected, open, fail, alive }: { selected: Set<string>; open: (r: ResourceSummary) => void } & Common) {
  const [query, setQuery] = useState(''); const [kind, setKind] = useState<SearchKind>('all');
  const [items, setItems] = useState<ResourceSummary[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<NotionError | null>(null); const [incomplete, setIncomplete] = useState(false);
  const run = useCallback(async (reset: boolean, after: string | null, q: string, k: SearchKind) => {
    setBusy(true); setError(null);
    try {
      const page = await notionSearch(q, k, after);
      if (!alive.current) return;
      setItems(prev => reset || !prev ? page.items : mergeById(prev, page.items)); setCursor(page.nextCursor); setMore(page.hasMore); setIncomplete(page.incomplete);
    } catch (e) { fail(e, setError); } finally { if (alive.current) setBusy(false); }
  }, [alive, fail]);
  useEffect(() => { void run(true, null, '', 'all'); }, [run]);
  const submit = (e: FormEvent) => { e.preventDefault(); void run(true, null, query, kind); };
  return <section aria-label="Notion content">
    <form className="notion-search" role="search" onSubmit={submit}>
      <label className="notion-search-field"><span className="sr-only">Search Notion titles</span><Search size={14} aria-hidden="true"/><input type="search" placeholder="Search titles" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <label className="sr-only" htmlFor="notion-kind">Show</label>
      <select id="notion-kind" value={kind} onChange={e => { const k = e.target.value as SearchKind; setKind(k); void run(true, null, query, k); }}><option value="all">Pages and data sources</option><option value="page">Pages</option><option value="data_source">Data sources</option></select>
      <button className="primary-button" type="submit" disabled={busy}>Search</button>
    </form>
    <Problem error={error}/>
    {busy && !items && <p role="status">Loading Notion content{'…'}</p>}
    {items && !items.length && !error && <div className="notion-empty-state"><strong>Nothing found</strong><p>CivilDesk only sees pages and databases that have been shared with the connection. In Notion, open a page, choose the {'…'} menu, then Connections, and add your connection. Then search again.</p></div>}
    {items && items.length > 0 && <ul className="notion-list" aria-label="Accessible Notion content">{items.map(r => <li key={r.id}>
      <button className="notion-item" onClick={() => open(r)}>
        <span className="notion-kind" aria-hidden="true">{r.resourceType === 'page' ? <FileText size={16}/> : <Database size={16}/>}</span>
        <span className="notion-item-text"><strong className={r.untitled ? 'notion-untitled' : undefined}>{r.icon ? r.icon + ' ' : ''}{r.name}</strong><small>{typeLabel(r.resourceType)}{r.lastEdited ? ' · edited ' + new Date(r.lastEdited).toLocaleDateString() : ''}</small></span>
        {selected.has(r.id) && <span className="notion-badge">Remembered</span>}
      </button></li>)}</ul>}
    {incomplete && <p className="notion-note">Notion reports this list may be incomplete. Narrow your search to find specific items.</p>}
    {more && <button className="soft-button" disabled={busy} onClick={() => void run(false, cursor, query, kind)}>{busy ? 'Loading…' : 'Load more'}</button>}
  </section>;
}

function SelectControl({ id, type, selected, onSources, fail, alive }: { id: string; type: ResourceType; selected: boolean; onSources: (s: SelectedSource[]) => void } & Common) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<NotionError | null>(null);
  const toggle = async () => { setBusy(true); setError(null); try { const next = await notionSetSourceSelected(id, type, !selected); if (alive.current) onSources(next); } catch (e) { fail(e, setError); } finally { if (alive.current) setBusy(false); } };
  return <div className="notion-select">
    <button className={selected ? 'soft-button' : 'primary-button'} aria-pressed={selected} disabled={busy} onClick={() => void toggle()}>{selected ? 'Remembered — remove' : 'Remember this source'}</button>
    <small>Remembering a source only saves its name and ID on this computer. Nothing is imported or synced.</small>
    <Problem error={error}/>
  </div>;
}

function DataSourceDetail({ id, selected, onSources, openDatabase, fail, alive }: { id: string; selected: boolean; onSources: (s: SelectedSource[]) => void; openDatabase: (id: string) => void } & Common) {
  const [ds, setDs] = useState<DataSourceView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  const [rows, setRows] = useState<EntryRow[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [more, setMore] = useState(false);
  const [rowsError, setRowsError] = useState<NotionError | null>(null); const [busy, setBusy] = useState(false);
  const loadRows = useCallback(async (after: string | null) => {
    setBusy(true); setRowsError(null);
    try { const p = await notionPreviewEntries(id, after); if (!alive.current) return; setRows(prev => mergeById(prev ?? [], p.rows)); setCursor(p.nextCursor); setMore(p.hasMore); } catch (e) { fail(e, setRowsError); } finally { if (alive.current) setBusy(false); }
  }, [id, alive, fail]);
  useEffect(() => { (async () => { try { const v = await notionOpenDataSource(id); if (!alive.current) return; setDs(v); await loadRows(null); } catch (e) { fail(e, setError); } })(); }, [id, alive, fail, loadRows]);
  if (error) return <Problem error={error}/>;
  if (!ds) return <p role="status">Loading data source{'…'}</p>;
  const columns = rows?.[0]?.cells.map(c => c.name) ?? [];
  return <section aria-label={'Data source ' + ds.name}>
    <h2 className="notion-title">{ds.name}</h2>
    <p className="notion-note">Data source{ds.databaseId && <> {'·'} <button className="link-button" onClick={() => openDatabase(ds.databaseId!)}>View its database</button></>}</p>
    <SelectControl id={ds.id} type="data_source" selected={selected} onSources={onSources} fail={fail} alive={alive}/>
    <h3>Properties</h3>
    <ul className="notion-props">{ds.properties.map(p => <li key={p.name}><strong>{p.name}</strong><span>{p.kind.replaceAll('_', ' ')}{!p.supported && ' (preview unsupported)'}</span>{p.options.length > 0 && <small>{p.options.slice(0, 8).join(', ')}{p.options.length > 8 ? '…' : ''}</small>}</li>)}</ul>
    <h3>Entry preview</h3>
    <Problem error={rowsError}/>
    {!rows && busy && <p role="status">Loading entries{'…'}</p>}
    {rows && !rows.length && !rowsError && <p className="notion-note">This data source has no entries visible to the connection.</p>}
    {rows && rows.length > 0 && <div className="notion-table-wrap"><table className="notion-table"><caption className="sr-only">Preview of entries in {ds.name}</caption><thead><tr><th scope="col">Name</th>{columns.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><th scope="row">{r.title}</th>{columns.map(c => { const cell = r.cells.find(x => x.name === c); return <td key={c}>{cell ? <Tags cell={cell}/> : null}</td>; })}</tr>)}</tbody></table></div>}
    {more && <button className="soft-button" disabled={busy} onClick={() => void loadRows(cursor)}>{busy ? 'Loading…' : 'Load more entries'}</button>}
  </section>;
}

function DatabaseDetail({ id, open, fail, alive }: { id: string; open: (id: string) => void } & Common) {
  const [db, setDb] = useState<DatabaseView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  useEffect(() => { notionOpenDatabase(id).then(v => { if (alive.current) setDb(v); }, e => fail(e, setError)); }, [id, alive, fail]);
  if (error) return <Problem error={error}/>;
  if (!db) return <p role="status">Loading database{'…'}</p>;
  return <section aria-label={'Database ' + db.name}>
    <h2 className="notion-title">{db.name}</h2>
    <p className="notion-note">A database can contain several data sources. Choose one to see its properties and entries.</p>
    {db.dataSources.length ? <ul className="notion-list">{db.dataSources.map(d => <li key={d.id}><button className="notion-item" onClick={() => open(d.id)}><span className="notion-kind" aria-hidden="true"><Database size={16}/></span><span className="notion-item-text"><strong>{d.name}</strong><small>Data source</small></span></button></li>)}</ul> : <p className="notion-note">No data sources are visible for this database.</p>}
  </section>;
}

function BlockLine({ b }: { b: BlockView }) {
  if (b.kind === 'divider') return <hr/>;
  if (b.kind === 'heading_1' || b.kind === 'heading_2') return <h3 className="notion-h">{b.text}</h3>;
  if (b.kind === 'heading_3' || b.kind === 'heading_4') return <h4 className="notion-h">{b.text}</h4>;
  if (b.kind === 'to_do') return <label className="notion-todo"><input type="checkbox" checked={!!b.checked} disabled readOnly/> <span>{b.text}</span></label>;
  if (b.kind === 'code') return <pre className="notion-code" aria-label={b.language ? 'Code, ' + b.language : 'Code'}>{b.text}</pre>;
  if (b.kind === 'quote' || b.kind === 'callout') return <blockquote>{b.text}</blockquote>;
  if (b.kind === 'bulleted_list_item' || b.kind === 'numbered_list_item') return <p className="notion-li">{'•'} {b.text}</p>;
  if (!b.supported || b.kind === 'image' || b.kind === 'file' || b.kind === 'pdf' || b.kind === 'video' || b.kind === 'audio') return <p className="notion-unsupported">{b.text}</p>;
  if (b.kind === 'child_page' || b.kind === 'child_database') return <p className="notion-note">{b.kind === 'child_page' ? 'Sub-page' : 'Sub-database'}: {b.text || 'Untitled'}</p>;
  return <p>{b.text}</p>;
}

function PageDetail({ id, selected, onSources, fail, alive }: { id: string; selected: boolean; onSources: (s: SelectedSource[]) => void } & Common) {
  const [page, setPage] = useState<PageView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  const [blocks, setBlocks] = useState<BlockView[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [more, setMore] = useState(false);
  const [blockError, setBlockError] = useState<NotionError | null>(null); const [busy, setBusy] = useState(false);
  const loadBlocks = useCallback(async (after: string | null) => {
    setBusy(true); setBlockError(null);
    try { const p = await notionPageBlocks(id, after); if (!alive.current) return; setBlocks(prev => mergeById(prev ?? [], p.blocks)); setCursor(p.nextCursor); setMore(p.hasMore); } catch (e) { fail(e, setBlockError); } finally { if (alive.current) setBusy(false); }
  }, [id, alive, fail]);
  useEffect(() => { (async () => { try { const v = await notionOpenPage(id); if (!alive.current) return; setPage(v); await loadBlocks(null); } catch (e) { fail(e, setError); } })(); }, [id, alive, fail, loadBlocks]);
  if (error) return <Problem error={error}/>;
  if (!page) return <p role="status">Loading page{'…'}</p>;
  return <section aria-label={'Page ' + page.title}>
    <h2 className={'notion-title' + (page.untitled ? ' notion-untitled' : '')}>{page.title}</h2>
    <p className="notion-note">Page{page.lastEdited ? ' · edited ' + new Date(page.lastEdited).toLocaleString() : ''}</p>
    <SelectControl id={page.id} type="page" selected={selected} onSources={onSources} fail={fail} alive={alive}/>
    {page.properties.length > 0 && <dl className="notion-dl">{page.properties.map(p => <div key={p.name}><dt>{p.name}</dt><dd><Tags cell={p}/></dd></div>)}</dl>}
    <h3>Content preview</h3>
    <Problem error={blockError}/>
    {!blocks && busy && <p role="status">Loading content{'…'}</p>}
    {blocks && !blocks.length && !blockError && <p className="notion-note">This page has no content visible to the connection.</p>}
    {blocks && blocks.length > 0 && <div className="notion-blocks">{blocks.map(b => <BlockLine key={b.id} b={b}/>)}</div>}
    <p className="notion-note">Read-only preview. Nested content, attachments and embeds are not loaded.</p>
    {more && <button className="soft-button" disabled={busy} onClick={() => void loadBlocks(cursor)}>{busy ? 'Loading…' : 'Load more'}</button>}
  </section>;
}
