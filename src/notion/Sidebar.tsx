import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Clock, Database, FileText, Search, Star, X } from 'lucide-react';
import { NotionError, notionPageBlocks, notionSearch, type ConnectionStatus, type ResourceSummary, type SearchKind, type SelectedSource } from '../services/notion';
import { useWorkspace } from './ctx';
import { mergeById } from './format';
import { fromSaved, session, type Resource } from './session';
import { Problem } from './Values';

const fromSummary = (r: ResourceSummary): Resource => ({ kind: r.resourceType === 'page' ? 'page' : 'ds', id: r.id, name: r.name, icon: r.icon });
const MAX_TREE_DEPTH = 3;

function ResourceIcon({ r }: { r: Resource }) {
  return <span className="nw-nav-icon" aria-hidden="true">{r.icon ?? (r.kind === 'page' ? <FileText size={15}/> : <Database size={15}/>)}</span>;
}

/**
 * A page row can be expanded to show its sub-pages. Those come from the page's own child blocks, which is the only
 * authoritative parent-child information; the search list never implies nesting.
 */
function NavItem({ r, depth, current }: { r: Resource; depth: number; current: Resource | null }) {
  const { open, alive, fail } = useWorkspace();
  const expandable = r.kind === 'page' && depth < MAX_TREE_DEPTH;
  const [expanded, setExpanded] = useState(!!session.expanded[r.id]);
  const [children, setChildren] = useState(session.tree.get(r.id) ?? null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<NotionError | null>(null);
  const loadChildren = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const prev = session.tree.get(r.id);
      const p = await notionPageBlocks(r.id, prev?.cursor ?? null);
      if (!alive.current) return;
      const found = p.blocks.filter(b => b.kind === 'child_page' || b.kind === 'child_database')
        .map((b): Resource => ({ kind: b.kind === 'child_page' ? 'page' : 'db', id: b.id, name: b.text || (b.kind === 'child_page' ? 'Untitled page' : 'Untitled database') }));
      const next = { items: mergeById(prev?.items ?? [], found), cursor: p.nextCursor, more: p.hasMore };
      session.tree.set(r.id, next); setChildren(next);
    } catch (e) { fail(e, setError); } finally { if (alive.current) setBusy(false); }
  }, [r.id, alive, fail]);
  const toggle = () => { const next = !expanded; setExpanded(next); session.expanded[r.id] = next; if (next && !children) void loadChildren(); };
  const active = current?.id === r.id;
  return <li className="nw-nav-node">
    <div className={'nw-nav-row' + (active ? ' active' : '')} style={{ paddingLeft: 6 + depth * 14 }}>
      {expandable ? <button className={'nw-chevron' + (expanded ? ' open' : '')} aria-expanded={expanded} aria-label={(expanded ? 'Collapse ' : 'Expand ') + r.name} onClick={toggle}><ChevronRight size={14} aria-hidden="true"/></button> : <span className="nw-chevron-gap" aria-hidden="true"/>}
      <button className="nw-nav-item" aria-current={active ? 'page' : undefined} title={r.name} onClick={() => open(r)}><ResourceIcon r={r}/><span className="nw-nav-name">{r.name}</span></button>
    </div>
    {expandable && expanded && <ul className="nw-nav-list" role="group" aria-label={'Inside ' + r.name}>
      {busy && !children && <li className="nw-nav-note" role="status">Loading{'…'}</li>}
      {children && !children.items.length && !children.more && !error && <li className="nw-nav-note">No sub-pages</li>}
      {children?.items.map(c => <NavItem key={c.id} r={c} depth={depth + 1} current={current}/>)}
      {children?.more && <li className="nw-nav-note"><button className="link-button" disabled={busy} onClick={() => void loadChildren()}>{busy ? 'Loading…' : 'Look for more sub-pages'}</button></li>}
      {error && <li><Problem error={error} onRetry={() => void loadChildren()}/></li>}
    </ul>}
  </li>;
}

function NavList({ items, current, label }: { items: Resource[]; current: Resource | null; label: string }) {
  return <ul className="nw-nav-list" aria-label={label}>{items.map(r => <NavItem key={r.kind + r.id} r={r} depth={0} current={current}/>)}</ul>;
}

export function Sidebar({ status, sources, current, offline, onClose, compact }: { status: ConnectionStatus | null; sources: SelectedSource[]; current: Resource | null; offline: boolean; onClose: () => void; compact: boolean }) {
  const { alive, fail } = useWorkspace();
  const [query, setQuery] = useState(''); const [kind, setKind] = useState<SearchKind>('all');
  const [active, setActive] = useState<{ q: string; kind: SearchKind } | null>(null);
  const [results, setResults] = useState<Resource[] | null>(null); const [rCursor, setRCursor] = useState<string | null>(null); const [rMore, setRMore] = useState(false);
  const [rBusy, setRBusy] = useState(false); const [rError, setRError] = useState<NotionError | null>(null); const [rIncomplete, setRIncomplete] = useState(false);
  const [shared, setShared] = useState(session.shared); const [sBusy, setSBusy] = useState(false); const [sError, setSError] = useState<NotionError | null>(null);
  const searchSeq = useRef(0);

  const loadShared = useCallback(async (after: string | null) => {
    setSBusy(true); setSError(null);
    try {
      const p = await notionSearch('', 'all', after); if (!alive.current) return;
      const next = { items: mergeById(after ? session.shared?.items ?? [] : [], p.items.map(fromSummary)), cursor: p.nextCursor, more: p.hasMore };
      session.shared = next; setShared(next);
    } catch (e) { fail(e, setSError); } finally { if (alive.current) setSBusy(false); }
  }, [alive, fail]);
  useEffect(() => { if (!session.shared) void loadShared(null); }, [loadShared]);

  const runSearch = useCallback(async (q: string, k: SearchKind, after: string | null) => {
    const seq = ++searchSeq.current; setRBusy(true); setRError(null);
    try {
      const p = await notionSearch(q, k, after);
      if (!alive.current || seq !== searchSeq.current) return;
      const items = p.items.map(fromSummary);
      setResults(prev => after && prev ? mergeById(prev, items) : items); setRCursor(p.nextCursor); setRMore(p.hasMore); setRIncomplete(p.incomplete);
    } catch (e) { if (seq === searchSeq.current) fail(e, setRError); } finally { if (alive.current && seq === searchSeq.current) setRBusy(false); }
  }, [alive, fail]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { clear(); return; }
    setActive({ q: query.trim(), kind }); setResults(null); void runSearch(query.trim(), kind, null);
  };
  const clear = () => { searchSeq.current++; setQuery(''); setActive(null); setResults(null); setRError(null); setRBusy(false); };
  const changeKind = (k: SearchKind) => { setKind(k); if (active) { setActive({ q: active.q, kind: k }); setResults(null); void runSearch(active.q, k, null); } };

  const savedItems = sources.map(fromSaved);
  const pages = shared?.items.filter(r => r.kind === 'page') ?? []; const databases = shared?.items.filter(r => r.kind !== 'page') ?? [];
  const label = offline ? 'Offline' : status?.state === 'connected' ? 'Connected' : status?.state === 'auth_failed' ? 'Authentication failed' : status?.state === 'restricted' ? 'Access restricted' : 'Not connected';
  const tone = offline ? 'warn' : status?.state === 'connected' ? 'ok' : 'bad';

  return <aside className="nw-sidebar" aria-label="Notion navigation">
    <div className="nw-identity">
      <span className="nw-ws-mark" aria-hidden="true">{(status?.workspaceName ?? 'N').charAt(0).toUpperCase()}</span>
      <div className="nw-ws-text"><strong title={status?.workspaceName ?? undefined}>{status?.workspaceName ?? 'Notion workspace'}</strong><small><span className={'nw-dot ' + tone} aria-hidden="true"/><span role="status">{label}</span>{' · read-only'}</small></div>
      {compact && <button className="icon-button" aria-label="Close navigation" onClick={onClose}><X size={16}/></button>}
    </div>
    <form className="nw-search" role="search" onSubmit={submit}>
      <label className="nw-search-field"><span className="sr-only">Search Notion titles</span><Search size={14} aria-hidden="true"/><input type="search" placeholder="Search titles" value={query} onChange={e => { setQuery(e.target.value); if (!e.target.value) clear(); }}/></label>
      <label className="sr-only" htmlFor="nw-kind">Show</label>
      <select id="nw-kind" value={kind} onChange={e => changeKind(e.target.value as SearchKind)}><option value="all">Pages and databases</option><option value="page">Pages only</option><option value="data_source">Databases only</option></select>
    </form>
    <div className="nw-scroll">
      {active ? <section aria-label="Search results">
        <h2 className="nw-nav-head">Results for {'“'}{active.q}{'”'} <button className="link-button" onClick={clear}>Clear</button></h2>
        {rBusy && !results && <p className="nw-nav-note" role="status">Searching{'…'}</p>}
        <Problem error={rError} onRetry={() => void runSearch(active.q, active.kind, rCursor)}/>
        {results && !results.length && !rError && <p className="nw-nav-note">Nothing found. CivilDesk only sees items shared with the connection.</p>}
        {results && results.length > 0 && <NavList items={results} current={current} label="Search results"/>}
        {rIncomplete && <p className="nw-nav-note">Notion says this list may be incomplete. Try a more specific title.</p>}
        {rMore && <button className="soft-button nw-more" disabled={rBusy} onClick={() => void runSearch(active.q, active.kind, rCursor)}>{rBusy ? 'Loading…' : 'Load more results'}</button>}
      </section> : <>
        {session.recents.length > 0 && <section aria-labelledby="nw-h-recent"><h2 id="nw-h-recent" className="nw-nav-head"><Clock size={12} aria-hidden="true"/> Recent</h2><NavList items={session.recents} current={current} label="Recently opened"/></section>}
        <section aria-labelledby="nw-h-saved"><h2 id="nw-h-saved" className="nw-nav-head"><Star size={12} aria-hidden="true"/> Saved sources</h2>
          {savedItems.length ? <NavList items={savedItems} current={current} label="Saved sources"/> : <p className="nw-nav-note">None yet. Open a page or database and choose {'“'}Remember source{'”'}.</p>}
        </section>
        <section aria-labelledby="nw-h-shared"><h2 id="nw-h-shared" className="nw-nav-head">Shared with CivilDesk</h2>
          {sBusy && !shared && <p className="nw-nav-note" role="status">Loading{'…'}</p>}
          <Problem error={sError} onRetry={() => void loadShared(shared?.cursor ?? null)}/>
          {shared && !shared.items.length && !sError && <div className="nw-empty-state"><strong>Nothing shared yet</strong><p>In Notion, open a page, choose the {'…'} menu, then Connections, and add your connection.</p></div>}
          {pages.length > 0 && <><h3 className="nw-nav-sub">Pages</h3><NavList items={pages} current={current} label="Shared pages"/></>}
          {databases.length > 0 && <><h3 className="nw-nav-sub">Databases</h3><NavList items={databases} current={current} label="Shared databases"/></>}
          {shared?.more && <button className="soft-button nw-more" disabled={sBusy} onClick={() => void loadShared(shared.cursor)}>{sBusy ? 'Loading…' : 'Load more'}</button>}
          <p className="nw-nav-note">Items appear in the order Notion returns them. Expand a page to see its sub-pages.</p>
        </section>
      </>}
    </div>
  </aside>;
}
