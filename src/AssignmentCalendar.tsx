import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { addDays } from './domain/dates';
import { calendarAssignments, compareAssignments, localCourseKey, monthDays, shiftMonth, sourceCourseKey, upcomingAssignments, weekDays, type CalendarAssignment } from './domain/assignmentCalendar';
import { brightspaceAssignments, brightspaceCancel, brightspaceCourseMode, type AssignmentSnapshot, type BrightspaceCourseMode } from './services/brightspace';
import { localDate } from './domain/scheduling';
import type { AcademicData } from './services/academic';
import type { WorkspaceData } from './services/workspace';
import './assignment-calendar.css';

type View = 'month' | 'week' | 'upcoming';
interface Props { data: WorkspaceData; academic: AcademicData; active: boolean; requestedCourse: string | null; onOpenCourse: (key: string) => void; onOpenLocalAssignment: (taskId: string) => void; onPlanLocal: (item: CalendarAssignment) => void }
const today = () => localDate(new Date());
const palette = ['#c58d9b', '#a98bd0', '#7aa7d2', '#74b8a2', '#cdb078', '#cf8b7a'];
const courseColor = (key: string) => palette[[...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % palette.length]!;
const sourceLabel = (item: CalendarAssignment) => item.source === 'local' ? 'CivilDesk local' : 'Synthetic Brightspace';
const deadlineLabel = (item: CalendarAssignment) => {
  const due = item.deadline;
  if (!due) return 'No recognized due date';
  return `${due.date}${due.time ? ` at ${due.time}` : ' · date only'}${due.zone === 'unverified' ? ' · timezone unverified' : due.zone === 'offset' ? ' · source offset supplied' : ''}`;
};

export function AssignmentCalendar({ data, academic, active, requestedCourse, onOpenCourse, onOpenLocalAssignment, onPlanLocal }: Props) {
  const [snapshot, setSnapshot] = useState<AssignmentSnapshot | null>(null);
  const [mode, setMode] = useState<BrightspaceCourseMode | null>(null);
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState('');
  const [previewTime, setPreviewTime] = useState('');
  const [previewMinutes, setPreviewMinutes] = useState(45);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => { let mounted = true; void brightspaceCourseMode().then(value => { if (mounted) setMode(value); }).catch(() => { if (mounted) setMode('unavailable'); }); return () => { mounted = false; }; }, []);
  useEffect(() => { const change = () => setOffline(!navigator.onLine); window.addEventListener('online', change); window.addEventListener('offline', change); return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
  useEffect(() => { if (requestedCourse) setSelectedCourses([requestedCourse]); }, [requestedCourse]);
  const all = useMemo(() => calendarAssignments(data, academic, snapshot), [data, academic, snapshot]);
  const visible = useMemo(() => all.filter(item => !selectedCourses.length || selectedCourses.includes(item.courseKey)).sort(compareAssignments), [all, selectedCourses]);
  const courses = useMemo(() => [
    ...academic.courses.filter(c => !c.archived).map(c => ({ key: localCourseKey(c.id), label: `${c.code} · ${c.name}`, source: 'Local' })),
    ...(snapshot?.courses ?? []).map(c => ({ key: sourceCourseKey(snapshot!.portalOrigin, c.id), label: `${c.code || c.id} · ${c.name}`, source: 'Synthetic' })),
  ], [academic.courses, snapshot]);
  const days = view === 'week' ? weekDays(cursor) : monthDays(cursor);
  const chosen = all.find(item => item.key === selectedItem) ?? null;
  const preview = chosen?.source === 'synthetic' && previewKey === chosen.key;
  const dayItems = visible.filter(item => item.deadline?.date === selectedDay);
  const unscheduled = visible.filter(item => !item.deadline);
  const upcoming = upcomingAssignments(visible, today());
  const warnings = snapshot?.results.filter(r => r.error || r.completeness?.status !== 'below_page_size_boundary') ?? [];
  const refresh = async () => {
    if (busy || offline || !mode || mode === 'unavailable') return;
    setBusy(true); setError('');
    try { const next = await brightspaceAssignments(); setSnapshot(next); }
    catch { setError('Assignment refresh failed. The last successful sample remains visible.'); }
    finally { setBusy(false); }
  };
  const step = (delta: number) => { const next = view === 'week' ? addDays(cursor, delta * 7) : shiftMonth(cursor, delta); setCursor(next); setSelectedDay(next); };
  const card = (item: CalendarAssignment) => <button key={item.key} className={`assignment-card ${item.source}`} style={{ borderLeftColor: courseColor(item.courseKey) }} onClick={() => setSelectedItem(item.key)}><strong>{item.title}</strong><small>{item.courseCode || item.courseName} · {sourceLabel(item)}</small><span>{deadlineLabel(item)}</span></button>;
  return <section className="assignment-calendar" hidden={!active} aria-label="Assignment Calendar">
    <header className="assignment-head"><div><span className="classes-eyebrow">SCHOOL / ASSIGNMENTS</span><h2>Assignment Calendar</h2><p>Local coursework and clearly labeled synthetic Brightspace assignments, kept separate.</p></div><div className="button-row">{mode !== 'unavailable' && <button className="soft-button" onClick={() => void refresh()} disabled={busy || offline || !mode}><RefreshCw size={15}/> {busy ? 'Refreshing…' : 'Refresh sample'}</button>}{busy && <button className="soft-button" onClick={() => void brightspaceCancel()}>Cancel</button>}</div></header>
    <p className="assignment-status" role="status">{offline ? 'Offline · showing local work and any in-memory sample.' : mode === 'unavailable' ? 'Synthetic Brightspace retrieval is unavailable in this build.' : busy ? 'Loading synthetic assignments…' : error && snapshot ? 'Refresh failed · showing stale sample data.' : snapshot ? `Sample retrieved ${new Date(snapshot.retrievedAtMs).toLocaleString()}. Assignment pages do not guarantee a complete course list.` : 'Local assignments are available. Refresh to load synthetic assignments.'}</p>
    {error && <p className="classes-error" role="alert">{error}</p>}
    {snapshot?.limitedCourseCount && <p className="assignment-warning">Only the first 12 synthetic courses were queried; more courses may have assignments.</p>}
    {warnings.map(w => <p className="assignment-warning" key={w.courseId}>{snapshot?.courses.find(c => c.id === w.courseId)?.name || w.courseId}: {w.error || (w.completeness?.status === 'potentially_truncated' ? 'The source page may be truncated.' : 'Source page completeness is unknown.')}</p>)}
    <div className="assignment-layout"><aside className="assignment-filters"><h3>Classes</h3><button className="text-link" onClick={() => setSelectedCourses([])}>All classes / clear filters</button>{courses.map(course => <label key={course.key}><input type="checkbox" checked={selectedCourses.includes(course.key)} onChange={e => setSelectedCourses(old => e.target.checked ? [...old, course.key] : old.filter(k => k !== course.key))}/><i className="assignment-color" style={{ background: courseColor(course.key) }} aria-hidden="true"/><span>{course.label}<small>{course.source}</small></span></label>)}</aside>
      <div className="assignment-main"><div className="assignment-toolbar"><div className="button-row"><button className="icon-button" aria-label="Previous academic period" onClick={() => step(-1)}><ChevronLeft size={17}/></button><button className="soft-button" onClick={() => { setCursor(today()); setSelectedDay(today()); }}>Today</button><button className="icon-button" aria-label="Next academic period" onClick={() => step(1)}><ChevronRight size={17}/></button><strong>{view === 'week' ? `${days[0]} – ${days[6]}` : cursor.slice(0, 7)}</strong></div><div className="button-row">{(['month', 'week', 'upcoming'] as const).map(v => <button key={v} className={view === v ? 'primary-button' : 'soft-button'} aria-pressed={view === v} onClick={() => { setView(v); if (v !== 'upcoming') setCursor(selectedDay); }}>{v[0]!.toUpperCase() + v.slice(1)}</button>)}</div></div>
        {view === 'upcoming' ? <section><h3>Upcoming assignments</h3>{upcoming.length ? <div className="assignment-list">{upcoming.map(card)}</div> : <p className="classes-empty">No upcoming dated assignments in the available results. Source lists may be incomplete.</p>}</section> : <><div className={`assignment-days ${view}`}><div className="assignment-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <span key={d}>{d}</span>)}</div><div className="assignment-cells">{days.map(day => { const items = visible.filter(item => item.deadline?.date === day); return <button key={day} className={`assignment-day ${day === selectedDay ? 'selected' : ''} ${view === 'month' && day.slice(0, 7) !== cursor.slice(0, 7) ? 'other-month' : ''}`} onClick={() => setSelectedDay(day)} aria-label={`${day}; ${items.length} assignments`}><strong>{day.slice(8)}</strong>{items.slice(0, view === 'week' ? 5 : 2).map(item => <span className={`assignment-chip ${item.source}`} style={{ background: `color-mix(in srgb, ${courseColor(item.courseKey)} 45%, #30252d)` }} key={item.key}>{item.title}</span>)}{items.length > (view === 'week' ? 5 : 2) && <small>+{items.length - (view === 'week' ? 5 : 2)} more</small>}</button>; })}</div></div><section><h3>{selectedDay}</h3>{dayItems.length ? <div className="assignment-list">{dayItems.map(card)}</div> : <p className="classes-empty">No assignments with a recognized deadline on this day.</p>}</section></>}
        <section><h3>Unscheduled</h3><p className="assignment-note">No positively recognized due date was supplied for these assignments.</p>{unscheduled.length ? <div className="assignment-list">{unscheduled.map(card)}</div> : <p className="classes-empty">No unscheduled assignments in the available results.</p>}</section>
      </div></div>
    {chosen && <div className="assignment-detail" role="dialog" aria-label="Assignment details"><button className="text-link" onClick={() => { setSelectedItem(null); setPreviewKey(null); }}><ChevronLeft size={15}/> Back to calendar</button><h3>{chosen.title}</h3><p>{chosen.courseName} · {chosen.courseCode || 'Code unavailable'}</p><dl><dt>Source</dt><dd>{sourceLabel(chosen)}</dd><dt>Due</dt><dd>{deadlineLabel(chosen)}</dd>{chosen.status && <><dt>Status shown by source</dt><dd>{chosen.status}</dd></>}{chosen.description && <><dt>Description</dt><dd>{chosen.description}</dd></>}</dl><div className="button-row"><button className="soft-button" onClick={() => { onOpenCourse(chosen.courseKey); setSelectedItem(null); }}>Open class</button>{chosen.taskId && <button className="soft-button" onClick={() => onOpenLocalAssignment(chosen.taskId!)}>Open local assignment</button>}<button className="primary-button" onClick={() => { if (chosen.source === 'local') onPlanLocal(chosen); else { setPreviewKey(chosen.key); setPreviewDate(''); setPreviewTime(''); setPreviewMinutes(45); } }}>Plan Study Session</button></div>
      {preview && <section className="assignment-plan-preview" aria-label="Synthetic study planning preview"><h4>Study planning preview</h4><p>This is a fictional Brightspace assignment. Its portal, course, and assignment identity remain in this in-memory preview. No study block or coursework is saved.</p><p><strong>{chosen.courseCode || chosen.courseName}</strong> · {chosen.title}</p><p>Assignment due: {deadlineLabel(chosen)}. Choose a separate local study time.</p><div className="assignment-plan-fields"><label>Study date<input type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)}/></label><label>Study time<input type="time" value={previewTime} onChange={e => setPreviewTime(e.target.value)}/></label><label>Duration in minutes<input type="number" min={5} max={480} step={5} value={previewMinutes} onChange={e => setPreviewMinutes(Number(e.target.value))}/></label></div>{previewDate && previewTime && previewMinutes >= 5 && previewMinutes <= 480 && <p role="status">Preview: {previewDate} at {previewTime} for {previewMinutes} minutes. No session will be created.</p>}<button className="soft-button" onClick={() => setPreviewKey(null)}>Close preview</button></section>}
    </div>}
  </section>;
}
