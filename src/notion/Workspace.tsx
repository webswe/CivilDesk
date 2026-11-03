import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft, Settings2 } from 'lucide-react';
import { NotionError, notionCancel, notionCheck, notionSelectedSources, notionStatus, type ConnectionStatus, type SelectedSource } from '../services/notion';
import { DataSourceContent, DatabaseContent, PageContent } from './Content';
import { WorkspaceContext, useWorkspace as useWorkspaceCtx, type WorkspaceCtx } from './ctx';
import { fromSaved, MAX_RECENTS, resetWorkspaceSession, session, type Resource } from './session';
import { Sidebar } from './Sidebar';
import { Problem } from './Values';
import './notion-workspace.css';

const COMPACT_AT = 1000;
const MIN_SIDEBAR = 220; const MAX_SIDEBAR = 480;
const isCompact = () => window.innerWidth <= COMPACT_AT;
const OFFLINE = new Set(['offline', 'timeout', 'tls']);

function Landing({ sources, openSidebar, compact }: { sources: SelectedSource[]; openSidebar: () => void; compact: boolean }) {
  const { open } = useWorkspaceCtx();
  return <section className="nw-landing" aria-label="Notion workspace">
    <h1>Notion</h1>
    <p>Browse the pages and databases you’ve shared with CivilDesk. It’s read-only: nothing is changed in Notion, and nothing is imported into CivilDesk.</p>
    {compact && <button className="primary-button" onClick={openSidebar}>Browse pages and databases</button>}
    {sources.length > 0 && <><h2>Saved sources</h2><ul className="nw-cards">{sources.map(fromSaved).map(r => <li key={r.id}><button className="nw-card" onClick={() => open(r)}>{r.name}</button></li>)}</ul></>}
    {!compact && <p className="nw-muted">Choose something from the sidebar, or search by title.</p>}
  </section>;
}

export function NotionWorkspace({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [sources, setSources] = useState<SelectedSource[]>([]);
  const [problem, setProblem] = useState<NotionError | null>(null);
  const [offline, setOffline] = useState(false); const [checking, setChecking] = useState(false);
  const [nav, setNav] = useState({ stack: session.stack, index: session.index });
  const [compact, setCompact] = useState(isCompact);
  // The drawer never persists across the compact breakpoint: narrow starts closed, wide starts open (or as the reader left it).
  const [sidebarOpen, setSidebarOpen] = useState(() => isCompact() ? false : session.sidebarOpen ?? true);
  const [width, setWidth] = useState(session.sidebarWidth);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null); const content = useRef<HTMLElement>(null); const dragging = useRef(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; void notionCancel(); }; }, []);
  useEffect(() => {
    const on = () => setCompact(prev => { const next = isCompact(); if (next !== prev) setSidebarOpen(!next); return next; });
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);
  // Local state only: opening the workspace reads the saved status and sources and does not contact Notion.
  useEffect(() => {
    (async () => {
      try {
        const [s, src] = await Promise.all([notionStatus(), notionSelectedSources()]);
        if (!alive.current) return;
        const identity = s.state === 'not_connected' ? null : (s.workspaceName ?? '') + '|' + (s.connectedAtMs ?? '');
        if (identity !== session.identity) { resetWorkspaceSession(); session.identity = identity; setNav({ stack: [], index: -1 }); }
        setStatus(s); setSources(src);
      } catch (e) { if (alive.current) setProblem(e instanceof NotionError ? e : new NotionError('storage', 'Notion details could not be read.')); }
      finally { if (alive.current) setReady(true); }
    })();
  }, []);
  useEffect(() => { session.stack = nav.stack; session.index = nav.index; }, [nav]);
  useEffect(() => { if (!compact) session.sidebarOpen = sidebarOpen; }, [sidebarOpen, compact]);
  const current: Resource | null = nav.stack[nav.index] ?? null;
  useEffect(() => { content.current?.scrollTo?.(0, 0); }, [current?.id]);

  const fail = useCallback((e: unknown, set: (e: NotionError) => void) => {
    if (!alive.current) return;
    const err = e instanceof NotionError ? e : new NotionError('unavailable', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.');
    if (err.kind === 'cancelled') return;
    set(err);
    if (OFFLINE.has(err.kind)) setOffline(true);
    if (err.kind === 'auth_failed' || err.kind === 'not_connected' || err.kind === 'restricted') void notionStatus().then(s => { if (alive.current) setStatus(s); }, () => undefined);
  }, []);
  const open = useCallback((r: Resource, opts?: { replace?: boolean }) => {
    session.recents = [r, ...session.recents.filter(x => x.id !== r.id)].slice(0, MAX_RECENTS);
    setNav(n => {
      const base = n.stack.slice(0, n.index + 1); const top = base[base.length - 1];
      if (top && top.id === r.id && top.kind === r.kind) return n;
      const stack = (opts?.replace ? [...base.slice(0, -1), r] : [...base, r]).slice(-50);
      return { stack, index: stack.length - 1 };
    });
    if (isCompact()) setSidebarOpen(false);
  }, []);
  const go = (delta: number) => setNav(n => { const i = n.index + delta; return i < 0 || i >= n.stack.length ? n : { ...n, index: i }; });
  const onSources = useCallback((next: SelectedSource[]) => { setSources(next); void notionStatus().then(s => { if (alive.current) setStatus(s); }, () => undefined); }, []);
  const retryConnection = async () => {
    setChecking(true);
    try { const s = await notionCheck(); if (alive.current) { setStatus(s); setOffline(false); setProblem(null); } }
    catch (e) { fail(e, setProblem); } finally { if (alive.current) setChecking(false); }
  };

  const ctx: WorkspaceCtx = useMemo(() => ({ alive, fail, open, selectedIds: new Set(sources.map(s => s.resourceId)), onSources }), [fail, open, sources, onSources]);

  const startDrag = (e: PointerEvent) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const drag = (e: PointerEvent) => {
    if (!dragging.current || !root.current) return;
    const w = Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX - root.current.getBoundingClientRect().left)));
    setWidth(w); session.sidebarWidth = w;
  };
  const endDrag = () => { dragging.current = false; };
  const resizeKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); const w = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, width + (e.key === 'ArrowRight' ? 20 : -20))); setWidth(w); session.sidebarWidth = w;
  };

  const connected = status?.state === 'connected';
  if (!ready) return <div className="nw nw-state"><p className="nw-muted" role="status">Opening Notion{'…'}</p></div>;
  if (!connected) return <div className="nw nw-state">
    <button className="soft-button" onClick={onBack}><ArrowLeft size={14} aria-hidden="true"/> Back to Settings</button>
    <div className="nw-empty-state"><strong>{status?.state === 'auth_failed' ? 'Notion needs a new token' : status?.state === 'restricted' ? 'Notion access is restricted' : 'Notion isn’t connected'}</strong><p>Open Settings to connect or repair the Notion connection. CivilDesk works fully without it.</p></div>
    <Problem error={problem}/>
  </div>;

  const showSidebar = sidebarOpen;
  return <WorkspaceContext.Provider value={ctx}>
    <div className={'nw' + (compact ? ' compact' : '')} ref={root} style={{ ['--nw-sidebar' as string]: width + 'px' }} onKeyDown={e => { if (e.key === 'Escape' && compact && sidebarOpen) setSidebarOpen(false); }}>
      <div className="nw-toolbar" role="toolbar" aria-label="Notion workspace">
        <button className="soft-button" onClick={onBack}><Settings2 size={14} aria-hidden="true"/> Settings</button>
        <button className="icon-button" aria-label={showSidebar ? 'Hide navigation' : 'Show navigation'} aria-expanded={showSidebar} aria-controls="nw-sidebar-region" onClick={() => setSidebarOpen(o => !o)}><PanelLeft size={17} aria-hidden="true"/></button>
        <button className="icon-button" aria-label="Back" disabled={nav.index <= 0} onClick={() => go(-1)}><ArrowLeft size={17} aria-hidden="true"/></button>
        <button className="icon-button" aria-label="Forward" disabled={nav.index >= nav.stack.length - 1} onClick={() => go(1)}><ArrowRight size={17} aria-hidden="true"/></button>
        <span className="nw-readonly">Read-only</span>
      </div>
      <div className="nw-body">
        {showSidebar && compact && <button className="nw-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setSidebarOpen(false)}/>}
        {showSidebar && <div id="nw-sidebar-region" className="nw-sidebar-region"><Sidebar status={status} sources={sources} current={current} offline={offline} compact={compact} onClose={() => setSidebarOpen(false)}/></div>}
        {showSidebar && !compact && <div className="nw-resizer" role="separator" aria-orientation="vertical" aria-label="Resize navigation" aria-valuenow={width} aria-valuemin={MIN_SIDEBAR} aria-valuemax={MAX_SIDEBAR} tabIndex={0} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={resizeKey}/>}
        <main className="nw-content" ref={content} aria-label="Notion content">
          {offline && <div className="nw-problem" role="alert"><span>CivilDesk can’t reach Notion right now. What’s already loaded stays visible; nothing in CivilDesk is affected.</span><button className="soft-button" disabled={checking} onClick={() => void retryConnection()}>{checking ? 'Checking…' : 'Try again'}</button></div>}
          {!current ? <Landing sources={sources} compact={compact} openSidebar={() => setSidebarOpen(true)}/>
            : current.kind === 'page' ? <PageContent key={current.id} id={current.id}/>
            : current.kind === 'ds' ? <DataSourceContent key={current.id} id={current.id}/>
            : <DatabaseContent key={current.id} id={current.id}/>}
        </main>
      </div>
    </div>
  </WorkspaceContext.Provider>;
}
