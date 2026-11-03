import { useCallback, useEffect, useState } from 'react';
import { Database, FileText } from 'lucide-react';
import { NotionError, notionOpenDataSource, notionOpenDatabase, notionOpenPage, notionPreviewEntries, notionSetSourceSelected, type DataSourceView, type DatabaseView, type EntryRow, type PageView, type ResourceType } from '../services/notion';
import { BlockList } from './Blocks';
import { useWorkspace } from './ctx';
import { formatNotionInstant, mergeById, propertyKindLabel } from './format';
import { cached, session, type Resource } from './session';
import { ExternalButton, Problem, PropertyValue } from './Values';

// ------------------------------------------------------------------ breadcrumbs

interface Crumb { label: string; icon?: string | null; resource?: Resource; note?: string; /** A database with exactly one data source opens straight to its table, so it is not a useful step back from that table. */ single?: boolean }
const getPage = (id: string) => cached(session.pages, id, () => notionOpenPage(id));
const getSource = (id: string) => cached(session.sources, id, () => notionOpenDataSource(id));
const getDatabase = (id: string) => cached(session.databases, id, () => notionOpenDatabase(id));

/**
 * Ancestors, followed only through the parent that Notion itself declares. A parent that can't be read is shown as
 * inaccessible; nothing is guessed, and the walk is bounded.
 */
async function resolveTrail(parentKind: string | null, parentId: string | null): Promise<Crumb[]> {
  const out: Crumb[] = [];
  let kind = parentKind; let id = parentId;
  for (let hops = 0; hops < 6; hops++) {
    if (kind === 'workspace') { out.unshift({ label: 'Workspace' }); break; }
    if (kind === 'block_id') { out.unshift({ label: 'Parent block', note: 'Notion doesn’t expose this parent' }); break; }
    if (!id || !kind) break;
    try {
      if (kind === 'page_id') { const p = await getPage(id); out.unshift({ label: p.title, icon: p.icon, resource: { kind: 'page', id, name: p.title, icon: p.icon } }); kind = p.parentKind; id = p.parentId; continue; }
      if (kind === 'data_source_id') {
        const d = await getSource(id); const trail: Crumb[] = [{ label: d.name, resource: { kind: 'ds', id, name: d.name } }];
        if (d.databaseId) { try { const db = await getDatabase(d.databaseId); if (db.dataSources.length > 1) trail.unshift({ label: db.name, resource: { kind: 'db', id: db.id, name: db.name } }); } catch { /* the data source is still a valid ancestor */ } }
        out.unshift(...trail); break;
      }
      if (kind === 'database_id') { const db = await getDatabase(id); out.unshift({ label: db.name, single: db.dataSources.length === 1, resource: { kind: 'db', id, name: db.name } }); break; }
    } catch { out.unshift({ label: 'Inaccessible parent', note: 'Not shared with this connection' }); }
    break;
  }
  return out;
}

function Breadcrumbs({ trail, current, loading }: { trail: Crumb[]; current: string; loading: boolean }) {
  const { open } = useWorkspace();
  return <nav className="nw-crumbs" aria-label="Notion breadcrumb"><ol>
    {trail.map((c, i) => <li key={i}>{c.resource
      ? <button className="nw-crumb" onClick={() => open(c.resource!)}>{c.icon ? c.icon + ' ' : ''}{c.label}</button>
      : <span className="nw-crumb static" title={c.note}>{c.label}</span>}</li>)}
    {loading && <li className="nw-muted" aria-hidden="true">{'…'}</li>}
    <li><span className="nw-crumb current" aria-current="page">{current}</span></li>
  </ol></nav>;
}

function useTrail(parentKind: string | null, parentId: string | null, ready: boolean) {
  const { alive } = useWorkspace();
  const [trail, setTrail] = useState<Crumb[]>([]); const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let live = true; setLoading(true);
    resolveTrail(parentKind, parentId).then(t => { if (live && alive.current) { setTrail(t); setLoading(false); } }, () => { if (live && alive.current) setLoading(false); });
    return () => { live = false; };
  }, [parentKind, parentId, ready, alive]);
  return { trail, loading };
}

// ------------------------------------------------------------------ shared pieces

function RememberButton({ id, type, name }: { id: string; type: ResourceType; name: string }) {
  const { selectedIds, onSources, alive, fail } = useWorkspace();
  const selected = selectedIds.has(id);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<NotionError | null>(null);
  const toggle = async () => { setBusy(true); setError(null); try { const next = await notionSetSourceSelected(id, type, !selected); if (alive.current) onSources(next); } catch (e) { fail(e, setError); } finally { if (alive.current) setBusy(false); } };
  return <>
    <button className={selected ? 'soft-button' : 'primary-button'} aria-pressed={selected} disabled={busy} title="Saves only the name and ID on this computer. Nothing is imported or synced." onClick={() => void toggle()}>{selected ? 'Remembered — remove' : 'Remember source'}</button>
    <Problem error={error}/><span className="sr-only">Remembering {name} saves only its name and ID on this computer.</span>
  </>;
}
function IconTile({ icon, kind }: { icon?: string | null; kind: 'page' | 'ds' | 'db' }) {
  return <span className="nw-icon-tile" aria-hidden="true">{icon ?? (kind === 'page' ? <FileText size={26}/> : <Database size={26}/>)}</span>;
}

// ------------------------------------------------------------------ page

export function PageContent({ id }: { id: string }) {
  const { alive, fail } = useWorkspace();
  const [page, setPage] = useState<PageView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  const load = useCallback(() => { setError(null); getPage(id).then(p => { if (alive.current) setPage(p); }, e => fail(e, setError)); }, [id, alive, fail]);
  useEffect(() => { load(); }, [load]);
  const { trail, loading } = useTrail(page?.parentKind ?? null, page?.parentId ?? null, !!page);
  if (error) return <Problem error={error} onRetry={load}/>;
  if (!page) return <p className="nw-muted" role="status">Loading page{'…'}</p>;
  const props = page.properties.filter(p => p.kind !== 'title');
  return <article className="nw-doc" aria-label={'Page ' + page.title}>
    <Breadcrumbs trail={trail} current={page.title} loading={loading}/>
    <header className="nw-doc-head">
      <IconTile icon={page.icon} kind="page"/>
      <h1 className={page.untitled ? 'nw-untitled' : undefined}>{page.title}</h1>
      <p className="nw-meta">{page.lastEdited ? 'Edited ' + formatNotionInstant(page.lastEdited) : 'Page'}</p>
      <div className="nw-actions"><RememberButton id={page.id} type="page" name={page.title}/><ExternalButton itemId={page.id} label="Open in Notion" className="soft-button">Open in Notion</ExternalButton></div>
    </header>
    {props.length > 0 && <dl className="nw-props" aria-label="Page properties">{props.map(p => <div key={p.name} className="nw-prop"><dt title={propertyKindLabel(p.kind)}>{p.name}</dt><dd><PropertyValue cell={p}/></dd></div>)}</dl>}
    <BlockList parentId={page.id} pageId={page.id} depth={0}/>
  </article>;
}

// ------------------------------------------------------------------ data source (table)

export function DataSourceContent({ id }: { id: string }) {
  const { alive, fail, open } = useWorkspace();
  const [ds, setDs] = useState<DataSourceView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  const [rows, setRows] = useState<EntryRow[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [more, setMore] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [rowsError, setRowsError] = useState<NotionError | null>(null); const [busy, setBusy] = useState(false);
  const loadRows = useCallback(async (after: string | null) => {
    setBusy(true); setRowsError(null);
    try { const p = await notionPreviewEntries(id, after); if (!alive.current) return; setRows(prev => mergeById(prev ?? [], p.rows)); setCursor(p.nextCursor); setMore(p.hasMore); setIncomplete(p.incomplete); }
    catch (e) { fail(e, setRowsError); } finally { if (alive.current) setBusy(false); }
  }, [id, alive, fail]);
  const load = useCallback(() => { setError(null); getSource(id).then(v => { if (!alive.current) return; setDs(v); void loadRows(null); }, e => fail(e, setError)); }, [id, alive, fail, loadRows]);
  useEffect(() => { load(); }, [load]);
  const { trail, loading } = useTrail(ds?.databaseId ? 'database_id' : null, ds?.databaseId ?? null, !!ds);
  if (error) return <Problem error={error} onRetry={load}/>;
  if (!ds) return <p className="nw-muted" role="status">Loading data source{'…'}</p>;
  const columns = ds.properties.filter(p => p.kind !== 'title');
  const titleName = ds.properties.find(p => p.kind === 'title')?.name ?? 'Name';
  const crumbs = trail.filter(c => !c.single);
  return <section className="nw-doc nw-database" aria-label={'Data source ' + ds.name}>
    <Breadcrumbs trail={crumbs} current={ds.name} loading={loading}/>
    <header className="nw-doc-head">
      <IconTile kind="ds"/>
      <h1 className={ds.untitled ? 'nw-untitled' : undefined}>{ds.name}</h1>
      <p className="nw-meta">Database{rows ? ' · ' + rows.length + (more ? '+' : '') + (rows.length === 1 ? ' entry' : ' entries') : ''}</p>
      <div className="nw-actions"><RememberButton id={ds.id} type="data_source" name={ds.name}/>{ds.databaseId && <ExternalButton itemId={ds.databaseId} label="Open in Notion" className="soft-button">Open in Notion</ExternalButton>}</div>
    </header>
    <details className="nw-details"><summary>Properties ({ds.properties.length})</summary>
      <ul className="nw-schema">{ds.properties.map(p => <li key={p.name}><strong>{p.name}</strong><span>{propertyKindLabel(p.kind)}{!p.supported && ' (not shown)'}</span>{p.options.length > 0 && <small>{p.options.slice(0, 8).join(', ')}{p.options.length > 8 ? '…' : ''}</small>}</li>)}</ul>
    </details>
    <Problem error={rowsError} onRetry={() => void loadRows(cursor)}/>
    {!rows && busy && <p className="nw-muted" role="status">Loading entries{'…'}</p>}
    {rows && !rows.length && !rowsError && <div className="nw-empty-state"><strong>No entries</strong><p>This database has no entries visible to the connection.</p></div>}
    {rows && rows.length > 0 && <div className="nw-table-wrap" tabIndex={0} aria-label={'Entries in ' + ds.name + ', scrollable'}>
      <table className="nw-table"><caption className="sr-only">Entries in {ds.name}. Select a row to open it as a page.</caption>
        <thead><tr><th scope="col" className="nw-title-col">{titleName}</th>{columns.map(c => <th scope="col" key={c.name} title={propertyKindLabel(c.kind)}>{c.name}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="nw-row" onClick={() => open({ kind: 'page', id: r.id, name: r.title })}>
          <th scope="row" className="nw-title-col"><button className="nw-row-open" onClick={e => { e.stopPropagation(); open({ kind: 'page', id: r.id, name: r.title }); }}>{r.title || 'Untitled'}</button></th>
          {columns.map(c => { const cell = r.cells.find(x => x.name === c.name); return <td key={c.name} className={c.kind === 'number' ? 'num' : undefined}>{cell ? <PropertyValue cell={cell}/> : <span className="nw-empty">Empty</span>}</td>; })}
        </tr>)}</tbody></table>
    </div>}
    {incomplete && <p className="nw-muted">Notion reports this list may be incomplete.</p>}
    {more && <button className="soft-button nw-more" disabled={busy} onClick={() => void loadRows(cursor)}>{busy ? 'Loading…' : 'Load more entries'}</button>}
  </section>;
}

// ------------------------------------------------------------------ database container

export function DatabaseContent({ id }: { id: string }) {
  const { alive, fail, open } = useWorkspace();
  const [db, setDb] = useState<DatabaseView | null>(null); const [error, setError] = useState<NotionError | null>(null);
  const load = useCallback(() => { setError(null); getDatabase(id).then(v => { if (!alive.current) return; setDb(v); if (v.dataSources.length === 1) { const d = v.dataSources[0]!; open({ kind: 'ds', id: d.id, name: d.name }, { replace: true }); } }, e => fail(e, setError)); }, [id, alive, fail, open]);
  useEffect(() => { load(); }, [load]);
  if (error) return <Problem error={error} onRetry={load}/>;
  if (!db) return <p className="nw-muted" role="status">Loading database{'…'}</p>;
  return <section className="nw-doc" aria-label={'Database ' + db.name}>
    <header className="nw-doc-head"><IconTile kind="db"/><h1>{db.name}</h1><p className="nw-meta">Database</p></header>
    {db.dataSources.length > 1 && <p className="nw-muted">This database has several data sources. Choose one to see its table.</p>}
    {db.dataSources.length
      ? <ul className="nw-cards">{db.dataSources.map(d => <li key={d.id}><button className="nw-card" onClick={() => open({ kind: 'ds', id: d.id, name: d.name })}><Database size={16} aria-hidden="true"/><span>{d.name}</span></button></li>)}</ul>
      : <div className="nw-empty-state"><strong>No data sources</strong><p>No data sources are visible for this database.</p></div>}
  </section>;
}
