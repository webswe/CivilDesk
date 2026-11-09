import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { brightspaceCancel, brightspaceCourseMode, brightspaceCourses, type BrightspaceCourse, type BrightspaceCourseMode, type BrightspaceCourseSnapshot } from './services/brightspace';
import type { Course } from './services/academic';
import './classes.css';

const colors = ['#c58d9b', '#a98bd0', '#7aa7d2', '#74b8a2', '#cdb078', '#cf8b7a'];
const courseKey = (portal: string, id: string) => `${portal}\u0000${id}`;
const display = (value: string, fallback: string) => value.trim() || fallback;

interface Props { localCourses: Course[]; onOpenLocal: (id: string) => void; active: boolean }

export function ClassesWorkspace({ localCourses, onOpenLocal, active }: Props) {
  const [snapshot, setSnapshot] = useState<BrightspaceCourseSnapshot | null>(null);
  const [mode, setMode] = useState<BrightspaceCourseMode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => { const update = () => setOffline(!navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { let active = true; void brightspaceCourseMode().then(value => { if (active) setMode(value); }).catch(() => { if (active) setMode('unavailable'); }); return () => { active = false; }; }, []);
  const courses = useMemo(() => snapshot?.courses ?? [], [snapshot]);
  const current = selected && snapshot ? courses.find(c => courseKey(snapshot.portalOrigin, c.id) === selected) : null;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return { remote: courses.filter(c => [c.name, c.code, c.semester_name].some(v => v.toLocaleLowerCase().includes(term))), local: localCourses.filter(c => [c.name, c.code].some(v => v.toLocaleLowerCase().includes(term))) };
  }, [courses, localCourses, query]);
  const refresh = async () => {
    if (busy || offline || !mode || mode === 'unavailable') return;
    setBusy(true); setError('');
    try {
      const next = await brightspaceCourses();
      setSnapshot(next);
      setSelected(old => old && next.courses.some(c => courseKey(next.portalOrigin, c.id) === old) ? old : null);
    } catch (reason) {
      // Rust returns fixed, sanitized messages. Keep unknown failures private.
      setError(typeof reason === 'string' ? reason : 'Classes could not be refreshed.');
    } finally { setBusy(false); }
  };
  return <section className="classes-workspace" hidden={!active} aria-label="Classes workspace">
    {current && snapshot ? <ClassDetail course={current} portal={snapshot.portalOrigin} mode={snapshot.mode} onBack={() => setSelected(null)}/> : <>
      <div className="classes-title"><div><span className="classes-eyebrow">SCHOOL / CLASSES</span><h2>Classes</h2><p>Browse your local courses and, when enabled, a clearly labeled synthetic Brightspace catalog.</p></div><div className="classes-actions">{mode !== 'unavailable' && <button className="soft-button" onClick={() => void refresh()} disabled={busy || offline || !mode}><RefreshCw size={15}/> {busy ? 'Refreshing…' : 'Refresh sample'}</button>}{busy && <button className="soft-button" onClick={() => void brightspaceCancel()}><X size={14}/> Cancel</button>}</div></div>
      <div className="classes-status" role="status">{offline ? 'Offline · showing only available in-memory information.' : mode === 'unavailable' ? 'Brightspace course retrieval is unavailable in this build.' : !mode ? 'Checking sample availability…' : busy ? 'Loading sample courses…' : error && snapshot ? 'Refresh failed · showing the last successful sample.' : snapshot ? `Sample retrieved ${new Date(snapshot.retrievedAtMs).toLocaleString()} · ${snapshot.complete ? 'complete result' : 'incomplete result'}` : 'Sample courses are not loaded. Refresh when ready.'}</div>
      {error && <p className="classes-error" role="alert">{error}</p>}
      {snapshot?.warnings.map((warning, index) => <p className="classes-error" key={index}>{warning}</p>)}
      <label className="classes-search"><Search size={16}/><span className="sr-only">Search classes</span><input aria-label="Search classes" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search classes by name, code, or term"/></label>
      <div className="classes-columns"><section aria-labelledby="sample-classes-heading"><div className="classes-section-heading"><h3 id="sample-classes-heading">Brightspace courses</h3><span className="classes-source">{mode === 'unavailable' ? 'Unavailable' : 'Demo / synthetic only'}</span></div>
        {!snapshot ? <div className="classes-empty">{mode === 'unavailable' ? 'Course discovery is reserved for an approved future connection.' : 'Refresh to load synthetic Brightspace courses. No real account is accessed.'}</div> : filtered.remote.length ? <div className="classes-grid">{filtered.remote.map((c, index) => <button className="classes-card" key={courseKey(snapshot.portalOrigin, c.id)} onClick={() => setSelected(courseKey(snapshot.portalOrigin, c.id))}><span className="classes-card-top"><span className="classes-swatch" style={{ background: colors[index % colors.length] }}/><span className="classes-code">{display(c.code, 'Code unavailable')}</span><ChevronRight size={16}/></span><strong>{display(c.name, 'Untitled course')}</strong><span className="classes-term">{display(c.semester_name, 'Term unavailable')}{!c.can_access ? ' · Access unavailable' : ''}</span><span className="classes-card-source">Synthetic Brightspace · ID {c.id}</span></button>)}</div> : <div className="classes-empty">{courses.length ? 'No sample classes match this search.' : 'The sample course list is empty.'}</div>}
      </section><section aria-labelledby="local-classes-heading"><div className="classes-section-heading"><h3 id="local-classes-heading">Your local courses</h3><span className="classes-source">CivilDesk</span></div>{filtered.local.length ? <div className="classes-local-list">{filtered.local.map(c => <button key={c.id} onClick={() => onOpenLocal(c.id)}><span className="classes-swatch" style={{ background: c.color || colors[0] }}/><span><strong>{c.code}</strong><small>{c.name}</small></span><ChevronRight size={15}/></button>)}</div> : <div className="classes-empty">{localCourses.length ? 'No local courses match this search.' : 'No local courses yet. Add one from School overview.'}</div>}</section></div>
    </>}
  </section>;
}

function ClassDetail({ course, portal, mode, onBack }: { course: BrightspaceCourse; portal: string; mode: BrightspaceCourseSnapshot['mode']; onBack: () => void }) {
  return <article className="classes-detail"><button className="text-link" onClick={onBack}><ChevronLeft size={15}/> Back to Classes</button><span className="classes-eyebrow">SYNTHETIC BRIGHTSPACE CLASS</span><h2>{display(course.name, 'Untitled course')}</h2><p className="classes-detail-code">{display(course.code, 'Code unavailable')} · {display(course.semester_name, 'Term unavailable')}</p><div className="classes-detail-meta"><div><span>Source</span><strong>{mode === 'demo' ? 'CivilDesk sample catalog' : 'Synthetic D2L-CLI fixture'}</strong></div><div><span>Course ID</span><strong>{course.id}</strong></div><div><span>Portal provenance</span><strong>{portal} (synthetic)</strong></div><div><span>Access flag</span><strong>{course.can_access ? 'Available in sample' : 'Unavailable in sample'}</strong></div><div><span>Source status</span><strong>{course.is_active ? 'Active' : 'Inactive'}</strong></div>{course.is_new_enrollment && <div><span>Enrollment</span><strong>New enrollment</strong></div>}{course.start_date && <div><span>Source start date</span><strong>{course.start_date}</strong></div>}{course.end_date && <div><span>Source end date</span><strong>{course.end_date}</strong></div>}</div><section className="classes-coming"><h3>Academic information</h3><p>Assignments, grades, announcements, and course-linked study sessions are unavailable for synthetic Brightspace classes in this phase. Nothing here is imported into your local School records.</p></section></article>;
}
