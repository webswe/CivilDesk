import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import type { ChallengeData } from '../services/challenges';
import type { Project, ProjectsData } from '../services/projects';
import {
  addGalleryImage, browseFolder, browseImages, exportCaseStudy, galleryImageData, isNativePortfolio, loadPortfolio, previewCaseStudy, removeGalleryItem, reorderGallery,
  saveCaseStudy, saveGalleryItem, setPortfolioMilestones, setPortfolioTools,
  type CaseStudyInput, type ExportResult, type GalleryItem, type PortfolioData, type PortfolioTool, type PreviewResult, type TeamKind, type ToolKind,
} from '../services/portfolio';
import { blankStudy, readiness, suggestionsFor } from '../domain/portfolio';

type View = 'write' | 'tools' | 'gallery' | 'timeline' | 'preview';
const views: { id: View; label: string }[] = [
  { id: 'write', label: 'Write' }, { id: 'tools', label: 'Software & skills' }, { id: 'gallery', label: 'Gallery' }, { id: 'timeline', label: 'Timeline' }, { id: 'preview', label: 'Preview & export' },
];
const commonSoftware = ['AutoCAD', 'Civil 3D', 'Revit', 'Navisworks'];
const commonSkills = ['Alignment design', 'Corridor modeling', 'Grading', 'Site planning', 'BIM modeling', 'Construction documentation', 'Technical drafting'];

interface Props {
  project: Project; projects: ProjectsData; challenges: ChallengeData | null;
  /** Refreshes the app's project data after the case study edits fields that live on the project record. */
  onProjectChanged: () => Promise<void>;
  setCandidate: (value: boolean) => Promise<void>;
}

export function PortfolioStudio(props: Props) {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState('');
  const reload = useCallback(async () => { try { setData(await loadPortfolio()); setLoadError(''); } catch (e) { setLoadError('Could not load the portfolio: ' + String(e)); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (loadError) return <p role="alert" className="form-error">{loadError}</p>;
  if (!data) return <p className="quiet-note" role="status">Opening Portfolio Studio…</p>;
  return <Studio key={props.project.id} {...props} data={data} reload={reload}/>;
}

function Studio({ project, projects, challenges, data, reload, onProjectChanged, setCandidate }: Props & { data: PortfolioData; reload: () => Promise<void> }) {
  const [view, setView] = useState<View>('write');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const study = data.studies.find(s => s.projectId === project.id);
  const tools = data.tools.filter(t => t.projectId === project.id);
  const gallery = data.gallery.filter(g => g.projectId === project.id).sort((a, b) => a.position - b.position);
  const selected = new Set(data.milestones.filter(m => m.projectId === project.id).map(m => m.milestoneId));
  const status = readiness(project, study, tools, gallery);
  /** Runs one change, refreshes, and shows any error instead of failing silently. */
  const act = async (op: () => Promise<void>, refreshProject = false): Promise<boolean> => {
    setBusy(true);
    try { await op(); await reload(); if (refreshProject) await onProjectChanged(); setMessage(''); return true; }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };
  const [draft, setDraft] = useState<CaseStudyInput>(() => toInput(project, study));
  // The last saved or loaded state. Comparing with it (not with props that refresh a moment later) keeps "unsaved" accurate.
  const [baseline, setBaseline] = useState<CaseStudyInput>(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const stored = JSON.stringify(toInput(project, study));
  // If the project was edited elsewhere (for example "Edit project"), adopt it, but never overwrite unsaved typing.
  useEffect(() => {
    if (!dirty && JSON.stringify(baseline) !== stored) { const next = JSON.parse(stored) as CaseStudyInput; setDraft(next); setBaseline(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);
  return <section className="project-section portfolio-studio" aria-labelledby="portfolio-heading">
    <div className="page-head">
      <div><h2 id="portfolio-heading">Portfolio Studio</h2>
        <p>A private case study for this project. Nothing leaves this computer unless you export it, and you review exactly what is included first.</p></div>
      <label className="check-inline"><input type="checkbox" checked={project.portfolioCandidate} onChange={e => void setCandidate(e.target.checked)}/> Portfolio candidate</label>
    </div>
    <p className="quiet-note portfolio-status" role="status">{status.done} of {status.total} parts started{status.missing.length ? ' · still empty: ' + status.missing.join(', ').toLowerCase() : ' · ready to preview'}{dirty ? ' · unsaved changes' : ''}</p>
    <div className="segmented portfolio-views" role="group" aria-label="Portfolio section">{views.map(v => <button key={v.id} className={view === v.id ? 'active' : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>)}</div>
    {message && <p role="alert" className="form-error">{message}</p>}
    {view === 'write' && <WriteView project={project} draft={draft} setDraft={setDraft} dirty={dirty} busy={busy} onSave={async () => { const ok = await act(() => saveCaseStudy(draft), true); if (ok) setBaseline(draft); return ok; }}/>}
    {view === 'tools' && <ToolsView project={project} projects={projects} challenges={challenges} tools={tools} gallery={gallery} busy={busy} act={act}/>}
    {view === 'gallery' && <GalleryView project={project} projects={projects} challenges={challenges} tools={tools} gallery={gallery} busy={busy} act={act}/>}
    {view === 'timeline' && <TimelineView project={project} projects={projects} selected={selected} busy={busy} act={act}/>}
    {view === 'preview' && <PreviewView project={project} dirty={dirty} stamp={JSON.stringify([data, project.updatedAtMs])}/>}
  </section>;
}

function toInput(p: Project, s = blankStudy(p.id)): CaseStudyInput {
  return { projectId: p.id, teamKind: s.teamKind, background: s.background, scope: s.scope, constraints: s.constraints, approach: s.approach, methodology: s.methodology, challenges: s.challenges, solutions: s.solutions, deliverables: s.deliverables, outcomes: s.outcomes, portfolioSummary: p.portfolioSummary, objectives: p.objectives, contributions: p.contributions, decisions: p.decisions, lessons: p.lessons };
}

type Field = { key: keyof CaseStudyInput; label: string; hint?: string; rows?: number };
const groups: { title: string; fields: Field[] }[] = [
  { title: 'Technical context', fields: [
    { key: 'background', label: 'Project background', hint: 'Where the work came from and why it mattered.' },
    { key: 'objectives', label: 'Problem or design objective' },
    { key: 'scope', label: 'Scope of work' },
    { key: 'constraints', label: 'Constraints or requirements' },
    { key: 'contributions', label: 'My role and responsibilities', hint: 'What you personally did. Be specific and accurate.' },
  ] },
  { title: 'Engineering process', fields: [
    { key: 'approach', label: 'Technical approach' },
    { key: 'methodology', label: 'Design methodology' },
    { key: 'decisions', label: 'Important decisions' },
    { key: 'challenges', label: 'Challenges encountered' },
    { key: 'solutions', label: 'Solutions implemented' },
  ] },
  { title: 'Results', fields: [
    { key: 'deliverables', label: 'Deliverables' },
    { key: 'outcomes', label: 'Outcomes', hint: 'Only what actually happened. Leave it empty rather than guess.' },
    { key: 'lessons', label: 'Lessons learned' },
  ] },
];

function WriteView({ project, draft, setDraft, dirty, busy, onSave }: { project: Project; draft: CaseStudyInput; setDraft: (d: CaseStudyInput) => void; dirty: boolean; busy: boolean; onSave: () => Promise<boolean> }) {
  const set = (patch: Partial<CaseStudyInput>) => setDraft({ ...draft, ...patch });
  const [saved, setSaved] = useState(false);
  return <form className="portfolio-form" onSubmit={async e => { e.preventDefault(); setSaved(await onSave()); }}>
    <div className="portfolio-identity">
      <strong>{project.title}</strong>
      <span>{project.discipline} · {project.projectType}{project.startDate || project.targetDate ? ' · ' + [project.startDate, project.targetDate].filter(Boolean).join(' to ') : ''}</span>
      <small>Title, discipline, type and dates come from the project. Use “Edit project” to change them.</small>
    </div>
    <label>Professional summary<small>Two or three sentences a reader sees first.</small>
      <textarea rows={3} maxLength={20000} value={draft.portfolioSummary} onChange={e => { set({ portfolioSummary: e.target.value }); setSaved(false); }}/></label>
    <label>Project type<select value={draft.teamKind} onChange={e => { set({ teamKind: e.target.value as TeamKind }); setSaved(false); }}><option value="individual">Individual project</option><option value="team">Team project</option></select></label>
    {groups.map((g, i) => <details key={g.title} className="more-options" open={i === 0 || g.fields.some(f => String(draft[f.key]).trim() !== '')}>
      <summary>{g.title}</summary>
      {g.fields.map(f => <label key={f.key}>{f.label}{f.hint && <small>{f.hint}</small>}<textarea rows={f.rows ?? 4} maxLength={20000} value={String(draft[f.key])} onChange={e => { set({ [f.key]: e.target.value } as Partial<CaseStudyInput>); setSaved(false); }}/></label>)}
    </details>)}
    <div className="dialog-actions portfolio-actions">
      {saved && !dirty && <span className="quiet-note" role="status">Draft saved</span>}
      <button className="primary-button" type="submit" disabled={busy || !dirty}>Save draft</button>
    </div>
  </form>;
}

type Act = (op: () => Promise<void>, refreshProject?: boolean) => Promise<boolean>;

function ToolsView({ project, projects, challenges, tools, gallery, busy, act }: { project: Project; projects: ProjectsData; challenges: ChallengeData | null; tools: PortfolioTool[]; gallery: GalleryItem[]; busy: boolean; act: Act }) {
  const [name, setName] = useState({ software: '', skill: '' });
  const sug = suggestionsFor(project, projects, challenges, tools, gallery);
  const save = (next: { kind: ToolKind; name: string; skillId: string | null }[]) => act(() => setPortfolioTools(project.id, next));
  const current = tools.map(t => ({ kind: t.kind, name: t.name, skillId: t.skillId }));
  const add = async (kind: ToolKind, value: string, skillId: string | null = null) => {
    const v = value.trim(); if (!v) return;
    if (current.some(t => t.kind === kind && t.name.toLowerCase() === v.toLowerCase())) return;
    if (await save([...current, { kind, name: v, skillId }])) setName(n => ({ ...n, [kind]: '' }));
  };
  const block = (kind: ToolKind, title: string, choices: string[], placeholder: string) => <div className="tool-block">
    <h3>{title}</h3>
    {tools.filter(t => t.kind === kind).length ? <ul className="chip-list">{tools.filter(t => t.kind === kind).map(t => <li key={t.id}>{t.name}<button className="icon-button" aria-label={'Remove ' + t.name} disabled={busy} onClick={() => void save(current.filter(c => !(c.kind === kind && c.name === t.name)))}><X size={14}/></button></li>)}</ul>
      : <p className="quiet-note">{kind === 'software' ? 'No software listed yet.' : 'No skills listed yet.'}</p>}
    <div className="inline-add">
      <label className="sr-only" htmlFor={'add-' + kind}>{placeholder}</label>
      <input id={'add-' + kind} list={'choices-' + kind} placeholder={placeholder} maxLength={100} value={name[kind]} onChange={e => setName({ ...name, [kind]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(kind, name[kind]); } }}/>
      <datalist id={'choices-' + kind}>{choices.map(c => <option key={c} value={c}/>)}</datalist>
      <button className="soft-button" disabled={busy || !name[kind].trim()} onClick={() => void add(kind, name[kind])}><Plus size={14}/> Add {kind}</button>
    </div>
  </div>;
  return <div className="portfolio-tools">
    <p className="quiet-note">List what you want a reader to see. A tool only appears here because you added it, and listing it does not claim proficiency.</p>
    {block('software', 'Software used', commonSoftware, 'Software name')}
    {block('skill', 'Skills practiced', commonSkills, 'Skill name')}
    {(sug.software.length > 0 || sug.skills.length > 0) && <div className="suggestions" aria-label="Suggestions from this project">
      <h3>Suggestions from this project</h3>
      <p className="quiet-note">Taken from the project’s software and its completed challenges. Completed challenges are self-reported exercises, so add only what you can stand behind.</p>
      <ul className="chip-list">{sug.software.map(s => <li key={'sw' + s}>{s}<button className="text-link" disabled={busy} aria-label={'Add software ' + s} onClick={() => void add('software', s)}>Add</button></li>)}
        {sug.skills.map(s => <li key={'sk' + s.id}>{s.title}<button className="text-link" disabled={busy} aria-label={'Add skill ' + s.title} onClick={() => void add('skill', s.title, s.id)}>Add</button></li>)}</ul>
    </div>}
  </div>;
}

function Thumb({ item }: { item: GalleryItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; setSrc(null); if (item.missing) return; galleryImageData(item.id).then(s => { if (live) setSrc(s); }, () => undefined); return () => { live = false; }; }, [item.id, item.missing]);
  if (item.missing) return <span className="thumb thumb-missing" role="img" aria-label="File missing">Missing</span>;
  return src ? <img className="thumb" src={src} alt={item.altText || item.caption || item.displayName}/> : <span className="thumb thumb-empty" aria-hidden="true"/>;
}

function GalleryView({ project, projects, challenges, tools, gallery, busy, act }: { project: Project; projects: ProjectsData; challenges: ChallengeData | null; tools: PortfolioTool[]; gallery: GalleryItem[]; busy: boolean; act: Act }) {
  const [path, setPath] = useState('');
  const [texts, setTexts] = useState<Record<string, { caption: string; alt: string }>>({});
  const [large, setLarge] = useState<GalleryItem | null>(null);
  const sug = suggestionsFor(project, projects, challenges, tools, gallery);
  const text = (g: GalleryItem) => texts[g.id] ?? { caption: g.caption, alt: g.altText };
  const move = (i: number, by: number) => { const ids = gallery.map(g => g.id); const [id] = ids.splice(i, 1); ids.splice(i + by, 0, id!); void act(() => reorderGallery(project.id, ids)); };
  const addPaths = async (paths: string[]) => { for (const p of paths) if (!await act(() => addGalleryImage(project.id, p))) return false; return true; };
  return <div className="portfolio-gallery">
    <p className="quiet-note">Choose the images you want to show. Only these are copied into an export; the originals are never moved, changed or deleted.</p>
    <div className="inline-add">
      {isNativePortfolio() && <button className="soft-button" disabled={busy} onClick={() => void browseImages().then(addPaths)}><Plus size={14}/> Choose images…</button>}
      <label className="sr-only" htmlFor="gallery-path">Advanced: absolute path to an image</label>
      <input id="gallery-path" placeholder="Advanced: absolute path to an image" value={path} onChange={e => setPath(e.target.value)}/>
      <button className="soft-button" disabled={busy || !path.trim()} onClick={() => void addPaths([path.trim()]).then(ok => { if (ok) setPath(''); })}>Add image</button>
    </div>
    {sug.images.length > 0 && <details className="more-options"><summary>Images already attached to this project ({sug.images.length})</summary>
      <ul className="suggest-list">{sug.images.map(i => <li key={i.path}><span>{i.label} <small>{i.source}</small></span><button className="soft-button" disabled={busy} aria-label={'Add ' + i.label + ' to gallery'} onClick={() => void act(() => addGalleryImage(project.id, i.path))}>Add to gallery</button></li>)}</ul></details>}
    {gallery.length ? <ul className="gallery-list" aria-label="Gallery images">{gallery.map((g, i) => <li key={g.id} className="gallery-row">
      <button className="thumb-button" aria-label={'Preview ' + (g.caption || g.displayName)} disabled={g.missing} onClick={() => setLarge(g)}><Thumb item={g}/></button>
      <div className="gallery-fields">
        <strong>{g.displayName}{g.missing && <span className="tag overdue">File missing</span>}</strong>
        <label>Caption<input maxLength={300} value={text(g).caption} onChange={e => setTexts({ ...texts, [g.id]: { ...text(g), caption: e.target.value } })}/></label>
        <label>Alternative text<small>Describe the image for readers who cannot see it.</small><input maxLength={500} value={text(g).alt} onChange={e => setTexts({ ...texts, [g.id]: { ...text(g), alt: e.target.value } })}/></label>
        <div className="button-row">
          <button className="soft-button" disabled={busy || (text(g).caption === g.caption && text(g).alt === g.altText)} aria-label={'Save text for ' + g.displayName} onClick={() => void act(() => saveGalleryItem(g.id, text(g).caption, text(g).alt)).then(ok => { if (ok) setTexts(t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== g.id))); })}>Save text</button>
          <button className="icon-button" aria-label={'Move ' + g.displayName + ' up'} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={15}/></button>
          <button className="icon-button" aria-label={'Move ' + g.displayName + ' down'} disabled={busy || i === gallery.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15}/></button>
          <button className="icon-button" aria-label={'Remove ' + g.displayName + ' from gallery'} title="Remove from the gallery (the file is kept)" disabled={busy} onClick={() => void act(() => removeGalleryItem(g.id))}><Trash2 size={15}/></button>
        </div>
      </div>
    </li>)}</ul> : <div className="empty-state compact" role="status"><p><strong>No gallery images yet.</strong> Add screenshots, drawings or renders that show the work.</p></div>}
    {large && <LargeImage item={large} onClose={() => setLarge(null)}/>}
  </div>;
}

function LargeImage({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); galleryImageData(item.id).then(setSrc, e => setError(String(e))); }, [item.id]);
  return <dialog className="rose-dialog image-dialog" ref={ref} onClose={onClose} aria-label={'Image preview: ' + (item.caption || item.displayName)}>
    {src ? <img src={src} alt={item.altText || item.caption || item.displayName}/> : <p>{error || 'Loading…'}</p>}
    {item.caption && <p>{item.caption}</p>}
    <div className="dialog-actions"><button className="soft-button" autoFocus onClick={() => ref.current?.close()}>Close</button></div>
  </dialog>;
}

function TimelineView({ project, projects, selected, busy, act }: { project: Project; projects: ProjectsData; selected: Set<string>; busy: boolean; act: Act }) {
  const ms = projects.milestones.filter(m => m.projectId === project.id).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const toggle = (id: string, on: boolean) => void act(() => setPortfolioMilestones(project.id, ms.map(m => m.id).filter(x => x === id ? on : selected.has(x))));
  if (!ms.length) return <div className="empty-state compact" role="status"><p><strong>No milestones yet.</strong> Add milestones under the Milestones tab, then choose which ones belong in the timeline.</p></div>;
  return <div className="portfolio-timeline">
    <p className="quiet-note">Choose the milestones to show. Only the title, date and whether it is complete are used; milestone notes stay private.</p>
    <ul className="check-list">{ms.map(m => <li key={m.id}><label><input type="checkbox" disabled={busy} checked={selected.has(m.id)} onChange={e => toggle(m.id, e.target.checked)}/> <span><strong>{m.title}</strong> <small>{m.targetDate}{m.completedAtMs ? ' · completed' : ''}</small></span></label></li>)}</ul>
  </div>;
}

function PreviewView({ project, dirty, stamp }: { project: Project; dirty: boolean; stamp: string }) {
  const native = isNativePortfolio();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState('');
  const [folder, setFolder] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [exists, setExists] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!native) return; let live = true;
    previewCaseStudy(project.id).then(p => { if (live) { setPreview(p); setError(''); } }, e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [project.id, native, stamp]);
  const doExport = async (overwrite: boolean) => {
    setWorking(true); setError(''); setResult(null);
    try { setResult(await exportCaseStudy(project.id, folder.trim(), overwrite)); setExists(false); }
    catch (e) { const text = e instanceof Error ? e.message : String(e); if (text.startsWith('EXISTS')) { setExists(true); } else { setExists(false); setError(text); } }
    finally { setWorking(false); }
  };
  if (!native) return <div className="empty-state compact" role="status"><p><strong>Preview and export need the desktop app.</strong> Authoring works here; run CivilDesk to see the finished case study and export it.</p></div>;
  return <div className="portfolio-preview">
    {dirty && <p className="quiet-note" role="status">You have unsaved changes. Save the draft in the Write section to include them.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {preview && <>
      <div className="export-review" aria-label="What the export contains">
        <h3>What will be included</h3>
        <ul>{preview.included.map(x => <li key={x}>{x}</li>)}</ul>
        <p className="quiet-note">Not included: file paths, journal entries, tasks, reminders, milestone notes, unselected files, or anything not listed above.</p>
        {preview.warnings.length > 0 && <ul className="warn-list" aria-label="Things to check">{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      </div>
      <iframe className="preview-frame" title={'Preview of ' + project.title} sandbox="" srcDoc={preview.html}/>
    </>}
    <div className="export-box">
      <h3>Export as a website folder</h3>
      <p className="quiet-note">Creates a folder with <code>index.html</code> and an <code>assets</code> folder. It opens without a server or an internet connection and is not uploaded anywhere.</p>
      <div className="inline-add">
        {native && <button className="soft-button" onClick={() => void browseFolder().then(f => { if (f) setFolder(f); })}>Choose folder…</button>}
        <label className="sr-only" htmlFor="export-folder">Export folder (absolute path)</label>
        <input id="export-folder" placeholder="Export folder (absolute path)" value={folder} onChange={e => { setFolder(e.target.value); setExists(false); }}/>
        <button className="primary-button" disabled={working || !folder.trim()} onClick={() => void doExport(false)}>Export case study</button>
      </div>
      {exists && <div className="replace-box" role="alert"><p>An export with this name already exists in that folder. Replacing it deletes only the earlier CivilDesk export.</p>
        <div className="button-row"><button className="primary-button" disabled={working} onClick={() => void doExport(true)}>Replace existing export</button><button className="soft-button" onClick={() => setExists(false)}>Cancel</button></div></div>}
      {result && <div className="export-done" role="status"><p><strong>Exported.</strong> {result.files.length} file{result.files.length === 1 ? '' : 's'} written to <code>{result.folder}</code></p>
        <ul>{result.files.map(f => <li key={f}>{f}</li>)}</ul>
        {result.warnings.length > 0 && <ul className="warn-list">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}</div>}
    </div>
  </div>;
}
