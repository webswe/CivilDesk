import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from './components/Modal';
import { NotionBrowser } from './NotionBrowser';
import { NotionError, notionCheck, notionConnect, notionDisconnect, notionSelectedSources, notionSetSourceSelected, notionStatus, type ConnectionStatus, type SelectedSource } from './services/notion';
import './notion.css';

/** A transient condition that is not persisted: the last verified state stays visible underneath it. */
type Live = { kind: 'connecting' | 'checking' | 'offline' | 'rate_limited' | 'unavailable'; message: string } | null;

function stateLabel(status: ConnectionStatus | null, live: Live): { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
  if (live?.kind === 'connecting') return { label: 'Connecting…', tone: 'idle' };
  if (live?.kind === 'checking') return { label: 'Checking…', tone: 'idle' };
  if (live?.kind === 'offline') return { label: 'Offline', tone: 'warn' };
  if (live?.kind === 'rate_limited') return { label: 'Rate limited', tone: 'warn' };
  if (live?.kind === 'unavailable') return { label: 'Connection unavailable', tone: 'warn' };
  switch (status?.state) {
    case 'connected': return { label: 'Connected', tone: 'ok' };
    case 'auth_failed': return { label: 'Authentication failed', tone: 'bad' };
    case 'restricted': return { label: 'Access restricted', tone: 'bad' };
    case 'unavailable': return { label: 'Connection unavailable', tone: 'warn' };
    default: return { label: 'Not connected', tone: 'idle' };
  }
}
function liveFrom(e: NotionError): Live {
  if (e.kind === 'offline' || e.kind === 'timeout' || e.kind === 'tls') return { kind: 'offline', message: e.message };
  if (e.kind === 'rate_limited') return { kind: 'rate_limited', message: e.message };
  if (e.kind === 'unavailable' || e.kind === 'invalid_response' || e.kind === 'storage') return { kind: 'unavailable', message: e.message };
  return null;
}
const when = (ms: number | null) => ms ? new Date(ms).toLocaleString() : 'Never';

export function NotionSettings() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [sources, setSources] = useState<SelectedSource[]>([]);
  const [live, setLive] = useState<Live>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Local state only: opening Settings never contacts Notion.
  const refreshLocal = useCallback(async () => {
    try { setStatus(await notionStatus()); setSources(await notionSelectedSources()); } catch (e) { setProblem(e instanceof Error ? e.message : 'Notion details could not be read.'); }
  }, []);
  useEffect(() => { void refreshLocal(); }, [refreshLocal]);

  const connected = status?.state === 'connected';
  const hasCredential = !!status && status.state !== 'not_connected';
  const showForm = !hasCredential || replacing;

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true); setProblem(null); setLive({ kind: 'connecting', message: '' });
    try {
      const next = await notionConnect(token);
      setToken(''); setReplacing(false); setLive(null); setStatus(next); setSources(await notionSelectedSources());
    } catch (err) {
      const error = err instanceof NotionError ? err : new NotionError('unavailable', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.');
      // The secret is dropped unless the failure is transient and the user is likely to retry the same value.
      if (!error.kind.match(/^(offline|timeout|tls|rate_limited|unavailable)$/)) setToken('');
      setLive(liveFrom(error)); setProblem(error.message);
    } finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setProblem(null); setLive({ kind: 'checking', message: '' });
    try { setStatus(await notionCheck()); setLive(null); }
    catch (err) {
      const error = err instanceof NotionError ? err : new NotionError('unavailable', 'Notion couldn’t be reached. Your CivilDesk data is unaffected.');
      setLive(liveFrom(error)); setProblem(error.message); await refreshLocal();
    } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setProblem(null);
    try { setStatus(await notionDisconnect()); setSources([]); setConfirming(false); setBrowsing(false); setLive(null); setReplacing(false); setToken(''); }
    catch (err) { setProblem(err instanceof Error ? err.message : 'Notion could not be disconnected.'); }
    finally { setBusy(false); }
  };
  const forget = async (s: SelectedSource) => {
    try { setSources(await notionSetSourceSelected(s.resourceId, s.resourceType, false)); setStatus(await notionStatus()); } catch (err) { setProblem(err instanceof Error ? err.message : 'That source could not be removed.'); }
  };
  const afterSources = (next: SelectedSource[]) => { setSources(next); void notionStatus().then(setStatus, () => undefined); };
  const onBrowseError = (e: NotionError) => { setLive(liveFrom(e)); void refreshLocal(); if (e.kind === 'not_connected') setBrowsing(false); };
  const badge = stateLabel(status, live);

  return <section className="setting-group notion-panel" aria-labelledby="notion-heading">
    <div className="notion-head"><h2 id="notion-heading">Notion</h2><span className={'notion-state notion-' + badge.tone} role="status">{badge.label}</span></div>
    <p className="notion-note">Read-only. CivilDesk can look at the Notion pages and databases you share with it. It never changes Notion, and nothing is synced or imported. CivilDesk works fully without Notion.</p>

    {problem && <p className="notion-problem" role="alert">{problem}</p>}
    {live && live.message && !problem && <p className="notion-problem" role="alert">{live.message}</p>}

    {hasCredential && <dl className="notion-facts">
      <div><dt>Workspace</dt><dd>{status.workspaceName ?? 'Not provided by Notion'}</dd></div>
      <div><dt>Last verified</dt><dd>{when(status.lastVerifiedAtMs)}</dd></div>
      <div><dt>Remembered sources</dt><dd>{status.selectedCount}</dd></div>
      <div><dt>API version</dt><dd>{status.apiVersion}</dd></div>
    </dl>}
    {status?.message && <p className="notion-note">{status.message}</p>}
    {status?.state === 'auth_failed' && <p className="notion-note">Notion no longer accepts the saved token, or it was never verified. Replace it with a current token, or disconnect.</p>}
    {status?.state === 'restricted' && <p className="notion-note">The connection can't read content. In Notion, make sure it has the {'“'}Read content{'”'} capability and is shared with your pages.</p>}

    {hasCredential && <div className="notion-actions">
      <button className="soft-button" onClick={() => void check()} disabled={busy}>Check connection</button>
      <button className="primary-button" onClick={() => setBrowsing(true)} disabled={busy || !connected}>Browse content</button>
      <button className="soft-button" onClick={() => setReplacing(r => !r)} aria-expanded={replacing}>Replace token</button>
      <button className="soft-button danger-link" onClick={() => setConfirming(true)} disabled={busy}>Disconnect</button>
    </div>}

    {confirming && <div className="notion-confirm" role="alertdialog" aria-labelledby="notion-confirm-title" aria-describedby="notion-confirm-body">
      <strong id="notion-confirm-title">Disconnect Notion?</strong>
      <p id="notion-confirm-body">This removes the saved token and your remembered sources from this computer. Your tasks, school work and other CivilDesk data are not affected. It does not revoke the connection in Notion: to do that, remove the connection from each shared page (the {'…'} menu, then Connections), or delete or regenerate the integration secret at notion.so/profile/integrations.</p>
      <div className="notion-actions"><button className="soft-button danger-link" onClick={() => void disconnect()} disabled={busy}>Disconnect and remove token</button><button className="soft-button" onClick={() => setConfirming(false)}>Keep connected</button></div>
    </div>}

    {showForm && <form className="notion-connect" onSubmit={e => void connect(e)} autoComplete="off">
      {!hasCredential && <ol className="notion-steps">
        <li>In Notion, open <strong>Settings {'›'} Connections {'›'} Develop or manage integrations</strong> and create an internal connection.</li>
        <li>Under Capabilities, enable <strong>Read content</strong> only. Turn off update, insert and user-email access.</li>
        <li>Share the pages or databases you want CivilDesk to see with that connection.</li>
        <li>Paste the connection secret below. CivilDesk keeps it in Windows Credential Manager, never in its database or files.</li>
      </ol>}
      <label htmlFor="notion-token">{replacing ? 'New connection token' : 'Connection token'}</label>
      <input id="notion-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the internal connection secret"/>
      <div className="notion-actions"><button className="primary-button" type="submit" disabled={busy || !token.trim()}>{replacing ? 'Replace and verify' : 'Connect'}</button>{replacing && <button type="button" className="soft-button" onClick={() => { setReplacing(false); setToken(''); }}>Cancel</button>}</div>
    </form>}

    {connected && <div className="notion-sources">
      <h3>Remembered sources</h3>
      {sources.length ? <ul className="simple-list">{sources.map(s => <li key={s.resourceId}><span>{s.displayName}<small>{s.resourceType === 'page' ? 'Page' : 'Data source'} {'·'} verified {when(s.lastVerifiedAtMs)}</small></span><button className="soft-button" onClick={() => void forget(s)} aria-label={'Stop remembering ' + s.displayName}>Remove</button></li>)}</ul>
        : <p className="notion-note">No sources remembered yet. Use Browse content and choose {'“'}Remember this source{'”'}.</p>}
    </div>}

    <Modal open={browsing} title="Notion content" onClose={() => setBrowsing(false)}>
      <div className="notion-dialog-head"><h2>Notion content</h2><button className="soft-button" onClick={() => setBrowsing(false)}>Close</button></div>
      <NotionBrowser sources={sources} onSources={afterSources} onError={onBrowseError}/>
    </Modal>
  </section>;
}
