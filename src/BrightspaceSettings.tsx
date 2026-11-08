import { useEffect, useState, type FormEvent } from 'react';
import { brightspaceCancel, brightspaceConfiguration, brightspaceInspect, brightspaceSaveConfiguration, type BrightspaceInspection } from './services/brightspace';
import './brightspace.css';

const labels: Record<string, string> = { not_configured: 'Not configured', configuration_error: 'Configuration error', cli_unavailable: 'CLI unavailable', cli_untrusted: 'Executable changed', cli_incompatible: 'CLI incompatible', cli_timeout: 'CLI timed out', output_too_large: 'CLI response too large', process_error: 'CLI error', cancelled: 'Check cancelled', authentication_required: 'Authentication required', credential_present_unverified: 'Credential stored, unverified', portal_mismatch: 'Portal mismatch', credential_error: 'Credential or storage error', verification_unavailable: 'Live verification unavailable' };

export function BrightspaceSettings() {
  const [portal, setPortal] = useState(''); const [executable, setExecutable] = useState('');
  const [inspection, setInspection] = useState<BrightspaceInspection | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  useEffect(() => { let active = true; void brightspaceConfiguration().then(config => { if (active) { setConfigured(config !== null); if (config) { setPortal(config.portalOrigin); setExecutable(config.executablePath); } } }).catch(() => { if (active) setProblem('Brightspace settings could not be loaded.'); }); return () => { active = false; }; }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setProblem(null); setInspection(null); try { const config = await brightspaceSaveConfiguration(portal, executable); setPortal(config.portalOrigin); setExecutable(config.executablePath); setConfigured(true); } catch (error) { setProblem(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Brightspace settings could not be saved.'); } finally { setBusy(false); } };
  const inspect = async () => { setBusy(true); setInspecting(true); setProblem(null); try { setInspection(await brightspaceInspect()); } catch { setProblem('Brightspace status could not be inspected.'); } finally { setBusy(false); setInspecting(false); } };
  const label = inspection ? labels[inspection.state] ?? 'CLI error' : configured === false ? 'Not configured' : 'Not checked';
  return <section className="setting-group brightspace-panel" aria-labelledby="brightspace-heading">
    <div className="brightspace-head"><h2 id="brightspace-heading">Brightspace</h2><span className="brightspace-badge" role="status">{label}</span></div>
    <p>Configure the portal and D2L-CLI executable you trust. CivilDesk checks local compatibility and credential presence only. It does not sign in, retrieve courses, or sync School data.</p>
    <form onSubmit={e => void save(e)} autoComplete="off">
      <label htmlFor="brightspace-portal">Brightspace portal origin</label>
      <input id="brightspace-portal" type="url" spellCheck={false} value={portal} onChange={e => setPortal(e.target.value)} placeholder="https://learn.example.edu" />
      <small>Use the plain HTTPS origin, without a path, query, or sign-in details.</small>
      <label htmlFor="brightspace-executable">Trusted D2L-CLI executable</label>
      <input id="brightspace-executable" type="text" spellCheck={false} value={executable} onChange={e => setExecutable(e.target.value)} placeholder="C:\\Tools\\d2l.exe" />
      <small>Choose an installed executable you trust. CivilDesk remembers its path and file fingerprint.</small>
      <div className="brightspace-actions"><button className="primary-button" type="submit" disabled={busy || !portal || !executable}>Save settings</button><button className="soft-button" type="button" onClick={() => void inspect()} disabled={busy}>Inspect status</button>{inspecting && <button className="soft-button" type="button" onClick={() => void brightspaceCancel()}>Cancel check</button>}</div>
    </form>
    {problem && <p role="alert" className="brightspace-problem">{problem}</p>}
    {inspection && <div className="brightspace-result"><p>{inspection.message}</p><dl>
      <div><dt>CLI available</dt><dd>{inspection.cliAvailable ? 'Yes' : 'No'}</dd></div>
      <div><dt>Contract compatible</dt><dd>{inspection.cliCompatible ? 'Yes' : 'No'}</dd></div>
      <div><dt>Profile</dt><dd>{inspection.profileId}</dd></div>
      <div><dt>Portal</dt><dd>{inspection.portalOrigin ?? 'Not set'}</dd></div>
    </dl></div>}
    <p className="brightspace-caution">A stored credential is unverified until Brightspace accepts a supported live check. Live verification is unavailable in the current CLI contract; no connection claim is made here.</p>
  </section>;
}
