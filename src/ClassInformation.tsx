import { useState } from 'react';
import { ChevronLeft, RefreshCw, X } from 'lucide-react';
import { brightspaceCancel, type BrightspaceAnnouncement, type BrightspaceCourse, type BrightspaceGradeItem, type ClassSnapshot } from './services/brightspace';

type Kind = 'overview' | 'grades' | 'announcements';
interface Feed<T> { snapshot: ClassSnapshot<T> | null; busy: boolean; error: string; refresh: () => Promise<void> }
interface Props {
  course: BrightspaceCourse; portal: string; mode: 'demo' | 'synthetic_cli'; offline: boolean;
  onBack: () => void; onOpenCalendar?: (courseKey: string) => void;
  grades: Feed<BrightspaceGradeItem>; announcements: Feed<BrightspaceAnnouncement>;
}
const display = (value: string, fallback: string) => value.trim() || fallback;
const source = (mode: Props['mode']) => mode === 'demo' ? 'CivilDesk fictional sample' : 'Synthetic D2L-CLI fixture';

export function ClassInformation({ course, portal, mode, offline, onBack, onOpenCalendar, grades, announcements }: Props) {
  const [view, setView] = useState<Kind>('overview');
  const selected = view === 'grades' ? grades : view === 'announcements' ? announcements : null;
  const page = selected?.snapshot?.portalOrigin === portal ? selected.snapshot.results.find(r => r.courseId === course.id) : null;
  const hasResult = page?.retrievedAtMs != null;
  return <article className="classes-detail">
    <button className="text-link" onClick={onBack}><ChevronLeft size={15}/> Back to Classes</button>
    <span className="classes-eyebrow">SYNTHETIC BRIGHTSPACE CLASS</span>
    <h2>{display(course.name, 'Untitled course')}</h2>
    <p className="classes-detail-code">{display(course.code, 'Code unavailable')} · {display(course.semester_name, 'Term unavailable')}</p>
    <nav className="classes-detail-tabs" aria-label="Class information">
      {(['overview', 'grades', 'announcements'] as const).map(tab => <button key={tab} className={view === tab ? 'primary-button' : 'soft-button'} aria-current={view === tab ? 'page' : undefined} onClick={() => setView(tab)}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>)}
      {onOpenCalendar && <button className="soft-button" onClick={() => onOpenCalendar(`synthetic:${portal}\u0000${course.id}`)}>Assignments</button>}
    </nav>
    {view === 'overview' ? <section aria-label="Class overview"><div className="classes-detail-meta">
      <div><span>Source</span><strong>{source(mode)}</strong></div><div><span>Course ID</span><strong>{course.id}</strong></div>
      <div><span>Portal provenance</span><strong>{portal} (synthetic)</strong></div><div><span>Access flag</span><strong>{course.can_access ? 'Available in sample' : 'Unavailable in sample'}</strong></div>
      <div><span>Source status</span><strong>{course.is_active ? 'Active' : 'Inactive'}</strong></div>{course.is_new_enrollment && <div><span>Enrollment</span><strong>New enrollment</strong></div>}
      {course.start_date && <div><span>Source start date</span><strong>{course.start_date}</strong></div>}{course.end_date && <div><span>Source end date</span><strong>{course.end_date}</strong></div>}
    </div><p className="classes-info-note">Class information is read only. Synthetic data is never imported into local School records.</p></section> : <section className="classes-feed" aria-label={`${view} for ${course.name}`}>
      <div className="classes-feed-head"><div><h3>{view === 'grades' ? 'Grades' : 'Announcements'}</h3><p>{source(mode)} · Course ID {course.id}</p></div>
        <div className="classes-actions"><button className="soft-button" onClick={() => void selected?.refresh()} disabled={selected?.busy || offline}><RefreshCw size={15}/> {selected?.busy ? 'Refreshing…' : 'Refresh sample'}</button>{selected?.busy && <button className="soft-button" onClick={() => void brightspaceCancel()}><X size={14}/> Cancel</button>}</div></div>
      <p className="classes-status" role="status">{offline ? 'Offline · showing available in-memory information.' : selected?.busy ? `Loading ${view}…` : selected?.error || page?.error ? 'Refresh failed · available cached data may be stale.' : hasResult ? `Last successful retrieval ${new Date(page!.retrievedAtMs!).toLocaleString()}.` : `Refresh to load synthetic ${view}.`}</p>
      {hasResult && (offline || selected?.error || page?.error) && <p className="classes-info-note">Last successful retrieval for this class: {new Date(page!.retrievedAtMs!).toLocaleString()}.</p>}
      {selected?.error && <p className="classes-error" role="alert">{selected.error}</p>}{page?.error && <p className="classes-error" role="alert">{page.error}</p>}
      {selected?.snapshot?.limitedCourseCount && <p className="classes-error">Only the first 12 synthetic courses were checked.</p>}
      {hasResult && <p className="classes-info-note">Source page completeness is unknown. These visible results may not include every {view === 'grades' ? 'grade item' : 'announcement'}.</p>}
      {view === 'grades' && page && !page.error && page.items.length === 0 && <p className="classes-empty">No grade items were returned in the available page. The full gradebook is not verified.</p>}
      {view === 'announcements' && page && !page.error && page.items.length === 0 && <p className="classes-empty">No announcements were returned in the available page. The full history is not verified.</p>}
      {view === 'grades' && page && <div className="classes-feed-list">{(page.items as BrightspaceGradeItem[]).map((item, index) => <article className="classes-feed-card" key={`${course.id}:${index}`}>
        <h4>{item.label}</h4><p className="classes-feed-source">{source(mode)} · Display order {index + 1}; no stable grade-item ID</p>
        <dl><div><dt>Displayed grade</dt><dd>{item.displayed_grade ?? 'Not shown by source; grading state unknown'}</dd></div><div><dt>Displayed points</dt><dd>{item.displayed_points ?? 'Not shown by source; not zero'}</dd></div><div><dt>Displayed weight</dt><dd>{item.displayed_weight ?? 'Not shown by source'}</dd></div><div><dt>Feedback</dt><dd>{item.feedback_availability === 'present' ? 'Available in source; text not retrieved' : item.feedback_availability === 'none' ? 'No feedback shown' : 'Availability unknown'}</dd></div></dl>
      </article>)}</div>}
      {view === 'announcements' && page && <div className="classes-feed-list">{(page.items as BrightspaceAnnouncement[]).map(item => <article className="classes-feed-card" key={`${portal}:${course.id}:${item.announcement_id}`}>
        <h4>{item.title}</h4><p className="classes-feed-source">{source(mode)} · Announcement ID {item.announcement_id}</p>
        <p className="classes-announcement-body">{item.body ?? 'No body supplied by source.'}</p><p className="classes-info-note">Publication date and author unavailable. Source reference is not opened.</p>
      </article>)}</div>}
    </section>}
  </article>;
}
