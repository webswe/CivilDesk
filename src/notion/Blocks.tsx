import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Database, FileText } from 'lucide-react';
import { NotionError, notionPageBlocks, type BlockView } from '../services/notion';
import { useWorkspace } from './ctx';
import { hostOf, isHttps, mergeById } from './format';
import { ExternalButton, Problem } from './Values';

/** Nested content is fetched one level at a time, on request, and stops at this depth. */
export const MAX_DEPTH = 4;
const ATTACHMENTS = new Set(['image', 'file', 'pdf', 'video', 'audio']);

function BlockBody({ b, n, pageId, open }: { b: BlockView; n: number | null; pageId: string; open: (kind: 'page' | 'db') => void }) {
  const safe = b.links.filter(isHttps);
  const links = safe.length > 0 && <span className="nw-links">{safe.map(l => <ExternalButton key={l} url={l} label={'Open link ' + hostOf(l)}>{hostOf(l)}</ExternalButton>)}</span>;
  switch (b.kind) {
    case 'divider': return <hr className="nw-divider"/>;
    case 'heading_1': return <h2 className="nw-h1">{b.text}{links}</h2>;
    case 'heading_2': return <h3 className="nw-h2">{b.text}{links}</h3>;
    case 'heading_3': case 'heading_4': return <h4 className="nw-h3">{b.text}{links}</h4>;
    case 'bulleted_list_item': return <div className="nw-li"><span className="nw-marker" aria-hidden="true">{'•'}</span><div className="nw-li-text">{b.text}{links}</div></div>;
    case 'numbered_list_item': return <div className="nw-li"><span className="nw-marker" aria-hidden="true">{n}.</span><div className="nw-li-text">{b.text}{links}</div></div>;
    case 'to_do': return <label className="nw-todo"><input type="checkbox" checked={!!b.checked} disabled readOnly/><span className={b.checked ? 'done' : undefined}>{b.text}{links}</span></label>;
    case 'quote': return <blockquote className="nw-quote">{b.text}{links}</blockquote>;
    case 'callout': return <div className="nw-callout" role="note">{b.text}{links}</div>;
    case 'code': return <pre className="nw-code" aria-label={b.language ? 'Code, ' + b.language : 'Code'}>{b.text}</pre>;
    case 'equation': return <pre className="nw-code" aria-label="Equation">{b.text}</pre>;
    case 'toggle': return <div className="nw-toggle-text">{b.text || 'Toggle'}{links}</div>;
    case 'paragraph': return b.text ? <p className="nw-p">{b.text}{links}</p> : <div className="nw-gap" aria-hidden="true"/>;
    case 'child_page': return <button className="nw-card" onClick={() => open('page')}><FileText size={16} aria-hidden="true"/><span>{b.text || 'Untitled page'}</span></button>;
    case 'child_database': return <button className="nw-card" onClick={() => open('db')}><Database size={16} aria-hidden="true"/><span>{b.text || 'Untitled database'}</span></button>;
    case 'bookmark': case 'embed': case 'link_preview': return isHttps(b.text)
      ? <div className="nw-card static"><span className="nw-card-kind">{b.kind === 'bookmark' ? 'Bookmark' : 'Link'}</span><ExternalButton url={b.text} label={'Open link ' + hostOf(b.text)}>{hostOf(b.text)}</ExternalButton></div>
      : <p className="nw-unsupported">{b.text || 'Link not shown'}</p>;
    default:
      if (ATTACHMENTS.has(b.kind) || !b.supported) return <div className="nw-card static nw-unfaithful" role="note"><span>{ATTACHMENTS.has(b.kind) ? b.text : 'This content can’t be shown in CivilDesk (' + b.kind.replaceAll('_', ' ') + ').'}</span><ExternalButton itemId={pageId} label="Open this page in Notion">Open in Notion</ExternalButton></div>;
      return <p className="nw-p">{b.text}{links}</p>;
  }
}

function BlockRow({ b, n, pageId, depth }: { b: BlockView; n: number | null; pageId: string; depth: number }) {
  const ws = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const nested = b.hasChildren && b.kind !== 'child_page' && b.kind !== 'child_database' && b.supported;
  const label = b.text ? b.text.slice(0, 60) : b.kind.replaceAll('_', ' ');
  return <div className={'nw-block nw-' + b.kind}>
    <div className="nw-block-line">
      {nested ? <button className={'nw-chevron' + (expanded ? ' open' : '')} aria-expanded={expanded} aria-label={(expanded ? 'Hide' : 'Show') + ' nested content of ' + label} onClick={() => setExpanded(x => !x)}><ChevronRight size={14} aria-hidden="true"/></button> : <span className="nw-chevron-gap" aria-hidden="true"/>}
      <div className="nw-block-body"><BlockBody b={b} n={n} pageId={pageId} open={kind => ws.open({ kind, id: b.id, name: b.text || (kind === 'page' ? 'Untitled page' : 'Untitled database') })}/></div>
    </div>
    {nested && expanded && <div className="nw-nested">{depth + 1 >= MAX_DEPTH
      ? <div className="nw-card static nw-unfaithful" role="note"><span>This is nested more deeply than CivilDesk shows.</span><ExternalButton itemId={pageId} label="Open this page in Notion">Open in Notion</ExternalButton></div>
      : <BlockList parentId={b.id} pageId={pageId} depth={depth + 1}/>}</div>}
  </div>;
}

/** One level of blocks, paginated. The children of a block are a separate BlockList, mounted only when the reader expands it. */
export function BlockList({ parentId, pageId, depth }: { parentId: string; pageId: string; depth: number }) {
  const { alive, fail } = useWorkspace();
  const [blocks, setBlocks] = useState<BlockView[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [more, setMore] = useState(false);
  const [error, setError] = useState<NotionError | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async (after: string | null) => {
    setBusy(true); setError(null);
    try { const p = await notionPageBlocks(parentId, after); if (!alive.current) return; setBlocks(prev => mergeById(prev ?? [], p.blocks)); setCursor(p.nextCursor); setMore(p.hasMore); }
    catch (e) { fail(e, setError); } finally { if (alive.current) setBusy(false); }
  }, [parentId, alive, fail]);
  useEffect(() => { void load(null); }, [load]);
  let run = 0;
  return <div className={'nw-blocks' + (depth ? ' nested' : '')}>
    {!blocks && busy && <p className="nw-muted" role="status">Loading content{'…'}</p>}
    <Problem error={error} onRetry={() => void load(cursor)}/>
    {blocks && !blocks.length && !error && depth === 0 && <p className="nw-muted">This page has no content visible to the connection.</p>}
    {blocks?.map(b => { run = b.kind === 'numbered_list_item' ? run + 1 : 0; return <BlockRow key={b.id} b={b} n={b.kind === 'numbered_list_item' ? run : null} pageId={pageId} depth={depth}/>; })}
    {more && <button className="soft-button nw-more" disabled={busy} onClick={() => void load(cursor)}>{busy ? 'Loading…' : 'Load more'}</button>}
  </div>;
}
