import { useState } from 'react';
import { Check, ExternalLink, Square } from 'lucide-react';
import { NotionError, notionOpenInNotion, notionOpenLink, type Cell } from '../services/notion';
import { DATE_KINDS, formatNotionDate, hostOf, isHttps } from './format';

/** Everything is rendered as React text nodes: no HTML from Notion, no remote images, and links open only on an explicit click. */
export function Problem({ error, onRetry }: { error: NotionError | null; onRetry?: () => void }) {
  if (!error) return null;
  return <div className="nw-problem" role="alert"><span>{error.message}</span>{onRetry && error.kind !== 'not_connected' && error.kind !== 'auth_failed' && <button className="soft-button" onClick={onRetry}>Retry</button>}</div>;
}

/** A button that opens an https link, or a Notion item, in the system browser. Failure is reported next to the control. */
export function ExternalButton({ url, itemId, label, className, children }: { url?: string; itemId?: string; label: string; className?: string; children: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setFailed(false);
    try { if (itemId) await notionOpenInNotion(itemId); else if (url) await notionOpenLink(url); } catch { setFailed(true); }
  };
  return <>
    <button type="button" className={className ?? 'nw-link'} aria-label={label} onClick={() => void run()}>{children}<ExternalLink size={12} aria-hidden="true"/></button>
    {failed && <span className="nw-inline-error" role="alert">Couldn’t open that.</span>}
  </>;
}

export const Empty = () => <span className="nw-empty" aria-label="Empty">Empty</span>;

/** A property value in its natural form: badge, tags, check, date, number or text. */
export function PropertyValue({ cell }: { cell: Cell }) {
  if (!cell.supported) return <span className="nw-unsupported" title={cell.text}>Not supported</span>;
  if (cell.empty) return <Empty/>;
  switch (cell.kind) {
    case 'status': return <span className="nw-status">{cell.text}</span>;
    case 'select': return <span className="nw-tag">{cell.text}</span>;
    case 'multi_select': return <span className="nw-tags">{cell.tags.map(t => <span key={t} className="nw-tag">{t}</span>)}</span>;
    case 'checkbox': return cell.text === 'Yes'
      ? <span className="nw-check on"><Check size={13} aria-hidden="true"/><span className="sr-only">Checked</span></span>
      : <span className="nw-check"><Square size={13} aria-hidden="true"/><span className="sr-only">Not checked</span></span>;
    case 'number': return <span className="nw-number">{cell.text}</span>;
    case 'url': return isHttps(cell.text) ? <ExternalButton url={cell.text} label={'Open link ' + hostOf(cell.text)}>{hostOf(cell.text)}</ExternalButton> : <>{cell.text}</>;
    default:
      if (DATE_KINDS.has(cell.kind) || (cell.kind === 'formula' && /^\d{4}-\d{2}-\d{2}/.test(cell.text))) return <time>{formatNotionDate(cell.text)}</time>;
      if (cell.tags.length) return <span className="nw-tags">{cell.tags.map(t => <span key={t} className="nw-tag">{t}</span>)}</span>;
      return <>{cell.text}</>;
  }
}
