import { useMemo, useState, type ReactNode } from 'react';
import { Archive, CalendarPlus, ChevronLeft, ChevronRight, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from './components/Modal';
import { ClassesWorkspace } from './ClassesWorkspace';
import { AssignmentCalendar } from './AssignmentCalendar';
import type { CalendarAssignment } from './domain/assignmentCalendar';
import { BlockDialog, GoalDialog, StudyView } from './StudyPanel';
import { assessmentStudy, editBlockDraft, formatMinutes, newBlockDraft, type BlockDraft, goalProgress, timeRange, upcomingBlocks, weekStartOf, weekTotals } from './domain/study';
import type { StudyBlock, StudyBlockInput, StudyData, StudyGoal } from './services/study';
import { TasksPage, type TaskScope } from './ProductivityPages';
import { taskDraft } from './domain/drafts';
import { activeSemester, academicTaskIds, attention, contextLabel, courseworkFor, courseworkItems, coursesIn, deadlineState, progress, validateSemesterDates, type CourseworkItem } from './domain/academic';
import { addDays } from './domain/agenda';
import { formatDue, relativeDay } from './domain/format';
import { localDate } from './domain/scheduling';
import { workTypeLabels, workTypeOrder, type AcademicData, type Course, type CourseInput, type CourseworkInput, type Semester, type SemesterInput, type WorkType } from './services/academic';
import type { Task, TaskInput, WorkspaceData } from './services/workspace';

/** Where to land in School when another page opens an item: a course/coursework row, or a study block. */
export interface SchoolFocus { courseId: string | null; taskId: string | null; blockId?: string | null; view?: 'study' }
export interface StudyContext { courseId?: string | null; taskId?: string | null; blockId?: string | null }
/** Runs a save and resolves to an error message (or null) so dialogs can show it next to the form. */
export type RunAcademic = (operation: () => Promise<void>) => Promise<string | null>;
interface Operations {
  saveSemester: (s: SemesterInput) => Promise<void>; setActive: (id: string | null) => Promise<void>; archiveSemester: (id: string, archived: boolean) => Promise<void>;
  saveCourse: (c: CourseInput) => Promise<void>; archiveCourse: (id: string, archived: boolean) => Promise<void>; saveCoursework: (c: CourseworkInput) => Promise<void>;
  saveBlock: (b: StudyBlockInput) => Promise<void>; cancelBlock: (id: string, cancelled: boolean) => Promise<void>; saveGoal: (g: StudyGoal) => Promise<void>;
}
interface Props {
  data: WorkspaceData; academic: AcademicData; study: StudyData; focus: SchoolFocus | null; startWithNew: boolean; ops: Operations; run: RunAcademic;
  onScope: (scope: TaskScope) => void; save: (task: TaskInput) => Promise<boolean>; remove: (id: string) => Promise<void>;
  complete: (id: string, value: boolean) => Promise<void>; startFocus: (taskId: string) => void; startStudy: (context: StudyContext) => void;
}
type Tab = 'upcoming' | 'assignments' | 'exams' | 'done';
const tabs: { id: Tab; label: string }[] = [{ id: 'upcoming', label: 'Open' }, { id: 'assignments', label: 'Assignments' }, { id: 'exams', label: 'Quizzes & exams' }, { id: 'done', label: 'Completed' }];
const palette = ['#c58d9b', '#a98bd0', '#7aa7d2', '#74b8a2', '#cdb078', '#cf8b7a'];
const HORIZON_DAYS = 14;

const blankSemester = (hasActive: boolean): SemesterInput => ({ id: crypto.randomUUID(), name: '', institution: '', startDate: '', endDate: '', makeActive: !hasActive });
const semesterDraft = (s: Semester): SemesterInput => ({ id: s.id, name: s.name, institution: s.institution, startDate: s.startDate, endDate: s.endDate, makeActive: false });
const blankCourse = (semesterId: string): CourseInput => ({ id: crypto.randomUUID(), semesterId, code: '', name: '', instructor: '', description: '', meetingSchedule: '', location: '', color: palette[0]! });
const courseDraft = (c: Course): CourseInput => ({ id: c.id, semesterId: c.semesterId, code: c.code, name: c.name, instructor: c.instructor, description: c.description, meetingSchedule: c.meetingSchedule, location: c.location, color: c.color });

export function SchoolPage({ data, academic, study, focus, startWithNew, ops, run, onScope, save, remove, complete, startFocus, startStudy }: Props) {
  const now = new Date();
  const today = localDate(now);
  const items = useMemo(() => courseworkItems(data.tasks, academic), [data.tasks, academic]);
  const linkedIds = useMemo(() => academicTaskIds(data.tasks, academic), [data.tasks, academic]);
  const focusCourse = focus ? academic.courses.find(c => c.id === focus.courseId) : undefined;
  const [semesterId, setSemesterId] = useState<string | null>(focusCourse?.semesterId ?? null);
  const [courseId, setCourseId] = useState<string | null>(focusCourse?.id ?? null);
  const [tab, setTab] = useState<Tab>(() => { const t = focus && data.tasks.find(x => x.id === focus.taskId); return t?.completedAtMs ? 'done' : 'upcoming'; });
  const [semDraft, setSemDraft] = useState<SemesterInput | null>(null);
  const [courseForm, setCourseForm] = useState<CourseInput | null>(null);
  const [work, setWork] = useState<(CourseworkInput & { isNew: boolean }) | null>(null);
  const [formError, setFormError] = useState('');
  const [view, setView] = useState<'overview' | 'classes' | 'calendar' | 'study'>(focus?.view ?? 'overview');
  const [calendarCourse, setCalendarCourse] = useState<string | null>(null);
  const [calendarVisited, setCalendarVisited] = useState(false);
  const [requestedClass, setRequestedClass] = useState<string | null>(null);
  const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null);
  const [originTaskId, setOriginTaskId] = useState<string | null>(null);
  const [goalCourse, setGoalCourse] = useState<Course | null>(null);

  const semester = academic.semesters.find(s => s.id === semesterId) ?? activeSemester(academic) ?? academic.semesters.find(s => !s.archived) ?? academic.semesters[0] ?? null;
  const courses = semester ? coursesIn(academic, semester.id) : [];
  const archivedCourses = semester ? coursesIn(academic, semester.id, true).filter(c => c.archived) : [];
  const course = courseId ? academic.courses.find(c => c.id === courseId) ?? null : null;
  const semesterItems = semester ? items.filter(i => i.course.semesterId === semester.id) : [];
  const attentionItems = (() => { const a = attention(semesterItems.filter(i => !i.course.archived), today, localDate(addDays(now, HORIZON_DAYS))); return [...a.overdue, ...a.today, ...a.upcoming]; })();
  const stats = progress(semesterItems);
  const undated = semesterItems.filter(i => !i.task.completedAtMs && !i.task.dueDate).length;
  const hasActive = academic.semesters.some(s => s.active);
  const readOnly = semester?.archived ?? false;

  const close = () => { setSemDraft(null); setCourseForm(null); setWork(null); setBlockDraft(null); setGoalCourse(null); setFormError(''); };
  const week = weekStartOf(now);
  function openBlock(courseId?: string, taskId: string | null = null, block?: StudyBlock) {
    const target = courseId ?? block?.courseId ?? course?.id ?? courses[0]?.id; if (!target) return;
    setFormError(''); setBlockDraft(block ? editBlockDraft(block) : newBlockDraft(target, taskId, now));
  }
  function planLocalAssignment(item: CalendarAssignment) {
    if (item.source !== 'local' || !item.taskId) return;
    const linked = items.find(x => x.task.id === item.taskId && x.course.id === item.courseKey.slice('local:'.length) && x.link.workType === 'assignment');
    if (!linked || linked.course.archived || academic.semesters.find(s => s.id === linked.course.semesterId)?.archived) return;
    setSemesterId(linked.course.semesterId);
    setCourseId(linked.course.id);
    setOriginTaskId(linked.task.id);
    setView('study');
    setFormError('');
    setBlockDraft({ ...newBlockDraft(linked.course.id, linked.task.id, now), title: linked.task.title.slice(0, 120), startDate: '', startTime: '' });
  }
  const blockCourses = academic.courses.filter(c => (semester && c.semesterId === semester.id && !c.archived) || c.id === blockDraft?.courseId);
  const originItem = originTaskId ? items.find(i => i.task.id === originTaskId && i.link.workType === 'assignment') : undefined;
  const blockSourceContext = originItem && blockDraft?.taskId === originItem.task.id
    ? `CivilDesk local assignment · ${originItem.course.code} · ${originItem.course.name}${originItem.task.dueDate ? ` · Due ${originItem.task.dueDate}${originItem.task.dueTime ? ` at ${originItem.task.dueTime}` : ''}` : ' · No due date'}`
    : undefined;
  const semesterStudy = { blocks: study.blocks.filter(b => courses.some(c => c.id === b.courseId)), sessions: study.sessions.filter(s => courses.some(c => c.id === s.courseId)) };
  const nextBlock = upcomingBlocks(semesterStudy, now)[0];
  const weekDone = weekTotals(semesterStudy.sessions, week);
  async function submit(operation: () => Promise<void>) { const message = await run(operation); if (message) setFormError(message); else close(); }
  function openNewWork(forCourse?: Course, task?: Task) {
    const target = forCourse ?? course ?? courses[0]; if (!target) return;
    setFormError(''); setWork({ task: task ? taskDraft(task) : taskDraft(undefined, 'school'), courseId: target.id, workType: 'assignment', referenceNotes: '', isNew: true });
  }
  function openEditWork(item: CourseworkItem) { setFormError(''); setWork({ task: taskDraft(item.task), courseId: item.course.id, workType: item.link.workType, referenceNotes: item.link.referenceNotes, isNew: false }); }
  const patchWork = (p: Partial<TaskInput>) => setWork(w => w ? { ...w, task: { ...w.task, ...p } } : w);

  const dueText = (t: Task) => t.dueDate ? formatDue(t.dueDate, t.dueTime, now) : null;
  function row(item: CourseworkItem, opts: { showCourse: boolean; lead?: boolean }) {
    const t = item.task; const due = dueText(t); const state = deadlineState(t, today);
    const assessment = (item.link.workType === 'exam' || item.link.workType === 'quiz') && !t.completedAtMs;
    const prep = assessment ? assessmentStudy(t.id, study, now) : null;
    const prepText = prep && (prep.completedMinutes || prep.plannedMinutes) ? [prep.completedMinutes ? 'Studied ' + formatMinutes(prep.completedMinutes) : '', prep.plannedMinutes ? formatMinutes(prep.plannedMinutes) + ' planned' : ''].filter(Boolean).join(', ') : '';
    return <li key={t.id} className={'course-row' + (focus?.taskId === t.id ? ' highlight' : '') + (t.completedAtMs ? ' task-done' : '')} aria-current={focus?.taskId === t.id ? 'true' : undefined}>
      <button className="task-check" aria-label={(t.completedAtMs ? 'Reopen ' : 'Complete ') + t.title} onClick={() => void complete(t.id, !t.completedAtMs)}>{t.completedAtMs ? '✓' : null}</button>
      <span className="course-row-text"><strong>{t.title}</strong>
        <small>{[opts.showCourse ? contextLabel(item) : item.link.workType === 'general' ? '' : workTypeLabels[item.link.workType], due ? (state === 'completed' ? due.text.replace('Overdue · ', '') : due.text) : 'No due date', t.priority === 'high' ? 'High priority' : '', t.subtasks.length ? t.subtasks.filter(s => s.done).length + '/' + t.subtasks.length + ' steps' : '', prepText].filter(Boolean).join(' · ')}</small>
        {t.description && focus?.taskId === t.id && <small className="course-row-note">{t.description}</small>}
      </span>
      {state === 'overdue' && <span className="tag overdue">Overdue</span>}{state === 'today' && <span className="tag">Today</span>}{opts.lead && <span className="tag">Next</span>}
      {assessment && !item.course.archived && <button className="icon-button" aria-label={'Plan study for ' + t.title} title="Plan study" onClick={() => openBlock(item.course.id, t.id)}><CalendarPlus size={15}/></button>}
      {!t.completedAtMs && <button className="icon-button" aria-label={'Start focus for ' + t.title} title="Start focus" onClick={() => startFocus(t.id)}><Play size={15}/></button>}
      <button className="icon-button" aria-label={'Edit ' + t.title} onClick={() => openEditWork(item)}><Pencil size={15}/></button>
    </li>;
  }

  const semesterBar = <div className="semester-bar">
    {semester ? <>
      <label className="semester-select"><span className="sr-only">Semester</span><select aria-label="Semester" value={semester.id} onChange={e => { setSemesterId(e.target.value); setCourseId(null); }}>
        {academic.semesters.filter(s => !s.archived).map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
        {academic.semesters.some(s => s.archived) && <optgroup label="Archived">{academic.semesters.filter(s => s.archived).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
      </select></label>
      {semester.active ? <span className="tag active-tag">Active semester</span> : !semester.archived && <button className="soft-button" onClick={() => void run(() => ops.setActive(semester.id))}>Make active</button>}
      {semester.archived && <span className="tag">Archived</span>}
      <button className="icon-button" aria-label="Edit semester" title="Edit semester" onClick={() => { setFormError(''); setSemDraft(semesterDraft(semester)); }}><Pencil size={15}/></button>
      <button className="icon-button" aria-label={semester.archived ? 'Restore semester' : 'Archive semester'} title={semester.archived ? 'Restore semester' : 'Archive semester'} onClick={() => { if (semester.archived || window.confirm('Archive ' + semester.name + '? Its courses and coursework are kept.')) void run(() => ops.archiveSemester(semester.id, !semester.archived)); }}>{semester.archived ? <RotateCcw size={15}/> : <Archive size={15}/>}</button>
    </> : null}
    <span className="bar-spacer"/>
    <button className="soft-button" onClick={() => { setFormError(''); setSemDraft(blankSemester(hasActive)); }}><Plus size={14}/> New semester</button>
    {semester && !readOnly && <button className="soft-button" onClick={() => { setFormError(''); setCourseForm(blankCourse(semester.id)); }}><Plus size={14}/> Add course</button>}
    {semester && !readOnly && <button className="primary-button" disabled={!courses.length} title={courses.length ? undefined : 'Add a course first'} onClick={() => openNewWork()}><Plus size={14}/> Add coursework</button>}
  </div>;

  const viewTabs = <div className="segmented school-views" role="group" aria-label="School view">{(semester ? ['overview', 'classes', 'calendar', 'study'] as const : ['overview', 'classes', 'calendar'] as const).map(v => <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => { setView(v); if (v === 'calendar') setCalendarVisited(true); if (v === 'overview') setCourseId(null); }}>{v === 'overview' ? 'Overview' : v === 'classes' ? 'Classes' : v === 'calendar' ? 'Assignment Calendar' : 'Study'}</button>)}</div>;
  let body: ReactNode;
  if (view === 'classes' || view === 'calendar') {
    body = null;
  } else if (!semester) {
    body = <div className="empty-state"><h2>No semesters yet</h2><p>Create a semester to organize your courses, assignments, quizzes and exams.</p><button className="primary-button" onClick={() => { setFormError(''); setSemDraft(blankSemester(hasActive)); }}>Create your first semester</button></div>;
  } else if (view === 'study') {
    body = <>{originItem && <button className="text-link" onClick={() => { setCalendarVisited(true); setView('calendar'); }}><ChevronLeft size={14}/> Back to assignment</button>}<StudyView study={study} academic={academic} courses={courses} tasks={data.tasks} now={now} highlightBlock={focus?.blockId ?? null} schedule={() => openBlock()} editBlock={b => openBlock(undefined, null, b)} startBlock={b => startStudy({ blockId: b.id, courseId: b.courseId, taskId: b.taskId })} startFocus={() => startStudy({})} setCancelled={(id, cancelled) => run(() => ops.cancelBlock(id, cancelled))} editGoal={c => { setFormError(''); setGoalCourse(c); }}/></>;
  } else if (course) {
    const all = courseworkFor(items, course.id);
    const shown = all.filter(i => tab === 'done' ? i.task.completedAtMs : !i.task.completedAtMs && (tab === 'upcoming' || (tab === 'assignments' ? i.link.workType === 'assignment' || i.link.workType === 'general' : i.link.workType === 'quiz' || i.link.workType === 'exam')));
    const counts: Record<Tab, number> = { upcoming: all.filter(i => !i.task.completedAtMs).length, assignments: all.filter(i => !i.task.completedAtMs && (i.link.workType === 'assignment' || i.link.workType === 'general')).length, exams: all.filter(i => !i.task.completedAtMs && (i.link.workType === 'quiz' || i.link.workType === 'exam')).length, done: all.filter(i => i.task.completedAtMs).length };
    const details = [course.instructor, course.location, course.meetingSchedule].filter(Boolean);
    body = <section className="course-detail" aria-label={course.code + ' ' + course.name}>
      <button className="text-link" onClick={() => setCourseId(null)}><ChevronLeft size={14}/> All courses</button>
      <div className="course-head"><span className="course-swatch" style={{ background: course.color || '#6b5360' }} aria-hidden="true"/><div><h2>{course.code}{course.archived && <span className="tag"> Archived</span>}</h2><p>{course.name}</p>{details.length > 0 && <small>{details.join(' · ')}</small>}</div>
        <div className="button-row"><button className="icon-button" aria-label="Edit course" title="Edit course" onClick={() => { setFormError(''); setCourseForm(courseDraft(course)); }}><Pencil size={15}/></button>
          <button className="icon-button" aria-label={course.archived ? 'Restore course' : 'Archive course'} title={course.archived ? 'Restore course' : 'Archive course'} onClick={() => { if (course.archived || window.confirm('Archive ' + course.code + '? Its coursework is kept and open work stays on your deadlines.')) void run(() => ops.archiveCourse(course.id, !course.archived)); }}>{course.archived ? <RotateCcw size={15}/> : <Archive size={15}/>}</button></div></div>
      {course.description && <p className="course-description">{course.description}</p>}
      {(() => {
        const mine = { blocks: study.blocks.filter(b => b.courseId === course.id), sessions: study.sessions.filter(x => x.courseId === course.id) };
        const next = upcomingBlocks(mine, now)[0]; const gp = goalProgress(study, course.id, week); const done = weekTotals(mine.sessions, week);
        const text = 'Studied ' + formatMinutes(done.minutes) + ' this week' + (gp?.goal.weeklyMinutes ? ' of ' + formatMinutes(gp.goal.weeklyMinutes) + (gp.minutesMet ? ' · goal met' : '') : '') + (next ? ' · Next: ' + relativeDay(next.startDate, now) + ' ' + timeRange(next) : '');
        return <div className="course-study" aria-label="Study for this course"><span>{text}</span>{!course.archived && <><button className="soft-button" onClick={() => openBlock(course.id)}><CalendarPlus size={14}/> Schedule study</button><button className="soft-button" onClick={() => startStudy({ courseId: course.id })}><Play size={14}/> Start focus</button></>}</div>;
      })()}
      <div className="segmented" role="group" aria-label="Coursework filter">{tabs.map(x => <button key={x.id} className={tab === x.id ? 'active' : ''} aria-pressed={tab === x.id} onClick={() => setTab(x.id)}>{x.label}<span>{counts[x.id]}</span></button>)}</div>
      {shown.length ? <ul className="course-list" aria-label="Coursework">{shown.map(i => row(i, { showCourse: false }))}</ul>
        : <div className="empty-state"><h2>{all.length === 0 ? 'No coursework yet' : tab === 'done' ? 'Nothing completed yet' : 'Nothing open here'}</h2><p>{all.length === 0 ? 'Add an assignment, quiz or exam for this course.' : tab === 'done' ? 'Completed coursework will be listed here.' : 'Everything in this view is done or filed elsewhere.'}</p>{all.length === 0 && !course.archived && <button className="primary-button" onClick={() => openNewWork(course)}>Add coursework</button>}</div>}
    </section>;
  } else {
    body = <>
      <section aria-labelledby="attention-heading" className="school-section">
        <h2 id="attention-heading">Needs attention</h2>
        {!courses.length ? null : attentionItems.length ? <ul className="course-list" aria-label="Upcoming coursework">{attentionItems.map((i, n) => row(i, { showCourse: true, lead: n === 0 }))}</ul>
          : <p className="quiet-note">{semesterItems.length ? 'No overdue work and nothing due in the next two weeks.' : 'No coursework yet. Add an assignment, quiz or exam to see it here.'}</p>}
      </section>
      {courses.length > 0 && (nextBlock || weekDone.sessions > 0) && <p className="quiet-note study-glance" aria-label="Study at a glance">{[nextBlock ? 'Next study: ' + relativeDay(nextBlock.startDate, now) + ' ' + timeRange(nextBlock) + ' · ' + (academic.courses.find(c => c.id === nextBlock.courseId)?.code ?? '') : '', weekDone.sessions ? 'Studied ' + formatMinutes(weekDone.minutes) + ' this week' : ''].filter(Boolean).join(' · ')} <button className="text-link" onClick={() => setView('study')}>Open Study</button></p>}
      <section aria-labelledby="courses-heading" className="school-section">
        <div className="classes-overview-link"><h2 id="courses-heading">Courses</h2><button className="text-link" onClick={() => setView('classes')}>Explore Classes <ChevronRight size={14}/></button><button className="text-link" onClick={() => { setCalendarVisited(true); setView('calendar'); }}>Assignment Calendar <ChevronRight size={14}/></button></div>
        {courses.length ? <div className="course-grid">{courses.map(c => { const mine = courseworkFor(items, c.id); const open = mine.filter(i => !i.task.completedAtMs); const nextDue = open.find(i => i.task.dueDate);
          return <button key={c.id} className="course-card" onClick={() => { setCourseId(c.id); setTab('upcoming'); }}><span className="course-swatch" style={{ background: c.color || '#6b5360' }} aria-hidden="true"/><span><strong>{c.code}</strong><span className="course-name">{c.name}</span><small>{open.length} open{nextDue ? ' · next ' + formatDue(nextDue.task.dueDate!, nextDue.task.dueTime, now).text.replace('Overdue · ', '') : ''}</small></span><ChevronRight size={15}/></button>; })}</div>
          : <div className="empty-state"><h2>No courses in {semester.name}</h2><p>{readOnly ? 'This semester is archived.' : 'Add the classes you are taking this semester.'}</p>{!readOnly && <button className="primary-button" onClick={() => { setFormError(''); setCourseForm(blankCourse(semester.id)); }}>Add a course</button>}</div>}
        {stats.total > 0 && <div className="day-progress" aria-label="Semester progress"><progress max={stats.total} value={stats.done} aria-label="Coursework completed this semester"/><span>{stats.done} of {stats.total} coursework items done{undated ? ' · ' + undated + ' without a deadline' : ''}</span></div>}
      </section>
      {(semesterItems.some(i => i.task.completedAtMs) || archivedCourses.length > 0) && <details className="more-options school-more">
        <summary>Completed work and archived courses</summary>
        {archivedCourses.length > 0 && <><h3>Archived courses</h3><ul className="course-list">{archivedCourses.map(c => <li key={c.id} className="course-row"><span className="course-row-text"><strong>{c.code}</strong><small>{c.name}</small></span><button className="soft-button" onClick={() => { setCourseId(c.id); setTab('upcoming'); }}>Open</button><button className="soft-button" onClick={() => void run(() => ops.archiveCourse(c.id, false))}>Restore</button></li>)}</ul></>}
        {semesterItems.some(i => i.task.completedAtMs) && <><h3>Completed coursework</h3><ul className="course-list" aria-label="Completed coursework">{semesterItems.filter(i => i.task.completedAtMs).sort((a, b) => (b.task.completedAtMs ?? 0) - (a.task.completedAtMs ?? 0)).map(i => row(i, { showCourse: true }))}</ul></>}
      </details>}
    </>;
  }

  const above = <div className="school-workspace">
    {semesterBar}{viewTabs}<ClassesWorkspace active={view === 'classes'} localCourses={academic.courses.filter(c => !c.archived)} requestedCourse={requestedClass} onOpenCalendar={key => { setCalendarCourse(key); setCalendarVisited(true); setView('calendar'); }} onOpenLocal={id => { setCourseId(id); setSemesterId(academic.courses.find(c => c.id === id)?.semesterId ?? null); setView('overview'); }}/>{calendarVisited && <AssignmentCalendar active={view === 'calendar'} data={data} academic={academic} requestedCourse={calendarCourse} onPlanLocal={planLocalAssignment} onOpenCourse={key => { if (key.startsWith('local:')) { const id = key.slice(6); setCourseId(id); setSemesterId(academic.courses.find(c => c.id === id)?.semesterId ?? null); setView('overview'); } else { setRequestedClass(key.slice(10)); setView('classes'); } }} onOpenLocalAssignment={id => { const linked = items.find(i => i.task.id === id); if (linked) { setCourseId(linked.course.id); setSemesterId(linked.course.semesterId); setTab('assignments'); setView('overview'); } }}/>} {body}
    <BlockDialog draft={blockDraft} setDraft={setBlockDraft} courses={blockCourses} academic={academic} tasks={data.tasks} sourceContext={blockSourceContext} error={formError} onClose={close} onSave={d => { const { isNew, ...input } = d; void isNew; void submit(() => ops.saveBlock(input)); }}/>
    <GoalDialog key={goalCourse?.id ?? 'none'} course={goalCourse} goal={goalCourse ? study.goals.filter(g => g.courseId === goalCourse.id && g.effectiveWeek <= week).sort((a, b) => b.effectiveWeek.localeCompare(a.effectiveWeek))[0] ?? null : null} week={week} error={formError} onClose={close} onSave={g => void submit(() => ops.saveGoal(g))}/>
    <Modal open={Boolean(semDraft)} title={semDraft && academic.semesters.some(s => s.id === semDraft.id) ? 'Edit semester' : 'New semester'} onClose={close}>{semDraft && (() => {
      const dateError = semDraft.startDate && semDraft.endDate ? validateSemesterDates(semDraft.startDate, semDraft.endDate) : '';
      const editing = academic.semesters.find(s => s.id === semDraft.id);
      return <form onSubmit={e => { e.preventDefault(); if (validateSemesterDates(semDraft.startDate, semDraft.endDate)) return; void submit(() => ops.saveSemester(semDraft)); }}>
        <h2>{editing ? 'Edit semester' : 'New semester'}</h2>
        <label>Name<input autoFocus required maxLength={80} placeholder="Fall 2026" value={semDraft.name} onChange={e => setSemDraft({ ...semDraft, name: e.target.value })}/></label>
        <label>Institution (optional)<input maxLength={120} value={semDraft.institution} onChange={e => setSemDraft({ ...semDraft, institution: e.target.value })}/></label>
        <div className="form-grid"><label>Start date<input type="date" required value={semDraft.startDate} onChange={e => setSemDraft({ ...semDraft, startDate: e.target.value })}/></label><label>End date<input type="date" required value={semDraft.endDate} onChange={e => setSemDraft({ ...semDraft, endDate: e.target.value })}/></label></div>
        {dateError && <p role="alert" className="form-error">{dateError}</p>}
        {!editing?.active && !editing?.archived && <label className="check-row">Make this the active semester<input type="checkbox" checked={semDraft.makeActive} onChange={e => setSemDraft({ ...semDraft, makeActive: e.target.checked })}/></label>}
        {formError && <p role="alert" className="form-error">{formError}</p>}
        <div className="dialog-actions"><button type="button" className="soft-button" onClick={close}>Cancel</button><button className="primary-button" type="submit">Save semester</button></div>
      </form>; })()}</Modal>
    <Modal open={Boolean(courseForm)} title={courseForm && academic.courses.some(c => c.id === courseForm.id) ? 'Edit course' : 'New course'} onClose={close}>{courseForm && <form onSubmit={e => { e.preventDefault(); void submit(() => ops.saveCourse(courseForm)); }}>
      <h2>{academic.courses.some(c => c.id === courseForm.id) ? 'Edit course' : 'New course'}</h2>
      <div className="form-grid"><label>Course code<input autoFocus required maxLength={30} placeholder="CSE 1321" value={courseForm.code} onChange={e => setCourseForm({ ...courseForm, code: e.target.value })}/></label>
        <label>Semester<select value={courseForm.semesterId} onChange={e => setCourseForm({ ...courseForm, semesterId: e.target.value })}>{academic.semesters.filter(s => !s.archived || s.id === courseForm.semesterId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      <label>Course name<input required maxLength={120} placeholder="Programming and Problem Solving" value={courseForm.name} onChange={e => setCourseForm({ ...courseForm, name: e.target.value })}/></label>
      <div className="form-grid"><label>Instructor (optional)<input maxLength={120} value={courseForm.instructor} onChange={e => setCourseForm({ ...courseForm, instructor: e.target.value })}/></label><label>Location (optional)<input maxLength={120} value={courseForm.location} onChange={e => setCourseForm({ ...courseForm, location: e.target.value })}/></label></div>
      <label>Meeting schedule (optional)<input maxLength={200} placeholder="Mon/Wed 10:00–11:15" value={courseForm.meetingSchedule} onChange={e => setCourseForm({ ...courseForm, meetingSchedule: e.target.value })}/></label>
      <p className="time-zone-note">The schedule is a note for you. It does not create Calendar events.</p>
      <label>Description (optional)<textarea rows={2} maxLength={5000} value={courseForm.description} onChange={e => setCourseForm({ ...courseForm, description: e.target.value })}/></label>
      <fieldset className="swatches"><legend>Color</legend>{palette.map(color => <label key={color} className="swatch"><input type="radio" name="course-color" checked={courseForm.color === color} onChange={() => setCourseForm({ ...courseForm, color })}/><span style={{ background: color }} title={color}/><span className="sr-only">{color}</span></label>)}</fieldset>
      {formError && <p role="alert" className="form-error">{formError}</p>}
      <div className="dialog-actions"><button type="button" className="soft-button" onClick={close}>Cancel</button><button className="primary-button" type="submit">Save course</button></div>
    </form>}</Modal>
    <Modal open={Boolean(work)} title={work?.isNew ? 'New coursework' : 'Edit coursework'} onClose={close}>{work && <form onSubmit={e => { e.preventDefault(); void submit(() => ops.saveCoursework({ task: work.task, courseId: work.courseId, workType: work.workType, referenceNotes: work.referenceNotes })); }}>
      <h2>{work.isNew ? 'New coursework' : 'Edit coursework'}</h2>
      <label>Title<input autoFocus required maxLength={200} value={work.task.title} onChange={e => patchWork({ title: e.target.value })}/></label>
      <div className="form-grid">
        <label>Type<select value={work.workType} onChange={e => setWork({ ...work, workType: e.target.value as WorkType })}>{workTypeOrder.map(t => <option key={t} value={t}>{workTypeLabels[t]}</option>)}</select></label>
        <label>Course<select value={work.courseId} onChange={e => setWork({ ...work, courseId: e.target.value })}>{academic.courses.filter(c => (!c.archived && !(academic.semesters.find(s => s.id === c.semesterId)?.archived)) || c.id === work.courseId).sort((a, b) => a.code.localeCompare(b.code)).map(c => <option key={c.id} value={c.id}>{c.code} · {academic.semesters.find(s => s.id === c.semesterId)?.name}</option>)}</select></label>
        <label>Due date<input type="date" value={work.task.dueDate || ''} onChange={e => patchWork({ dueDate: e.target.value || null, dueTime: e.target.value ? work.task.dueTime : null })}/></label>
        <label>Due time<input type="time" disabled={!work.task.dueDate} value={work.task.dueTime || ''} onChange={e => patchWork({ dueTime: e.target.value || null })}/></label>
        <label>Priority<select value={work.task.priority} onChange={e => patchWork({ priority: e.target.value as TaskInput['priority'] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        {work.task.dueDate && <label>Reminder<select value={work.task.reminderOffsetMinutes ?? ''} onChange={e => patchWork({ reminderOffsetMinutes: e.target.value === '' ? null : Number(e.target.value) })}><option value="">None</option><option value="0">At due time</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>}
      </div>
      <details className="more-options" open={Boolean(work.task.description || work.referenceNotes || work.task.subtasks.length)}><summary>Instructions, references and steps</summary>
        <label>Instructions<textarea rows={3} maxLength={10000} value={work.task.description} onChange={e => patchWork({ description: e.target.value })}/></label>
        <label>References (links or notes)<textarea rows={2} maxLength={5000} value={work.referenceNotes} onChange={e => setWork({ ...work, referenceNotes: e.target.value })}/></label>
        <fieldset className="subtasks"><legend>Steps</legend>{work.task.subtasks.map((s, i) => <div className="subtask-row" key={s.id}><input type="checkbox" aria-label={'Complete step ' + (i + 1)} checked={s.done} onChange={e => patchWork({ subtasks: work.task.subtasks.map(x => x.id === s.id ? { ...x, done: e.target.checked } : x) })}/><input aria-label={'Step ' + (i + 1)} value={s.title} maxLength={200} onChange={e => patchWork({ subtasks: work.task.subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x) })}/><button type="button" className="icon-button" aria-label={'Remove step ' + (i + 1)} onClick={() => patchWork({ subtasks: work.task.subtasks.filter(x => x.id !== s.id) })}><Trash2 size={15}/></button></div>)}<button type="button" className="soft-button" onClick={() => patchWork({ subtasks: [...work.task.subtasks, { id: crypto.randomUUID(), title: '', done: false }] })}><Plus size={14}/> Add step</button></fieldset>
      </details>
      {formError && <p role="alert" className="form-error">{formError}</p>}
      <div className="dialog-actions">{!work.isNew && linkedIds.has(work.task.id) && <button type="button" className="soft-button danger-link" onClick={() => { if (window.confirm('Delete "' + work.task.title + '"? Earned rewards remain yours.')) { const id = work.task.id; close(); void remove(id); } }}><Trash2 size={14}/> Delete</button>}<span className="bar-spacer"/><button type="button" className="soft-button" onClick={close}>Cancel</button><button className="primary-button" type="submit">Save coursework</button></div>
    </form>}</Modal>
  </div>;

  const extras = {
    academicIds: linkedIds, above, hide: (t: Task) => linkedIds.has(t.id),
    listHeading: 'Other school tasks',
    rowExtra: (t: Task) => courses.length && !readOnly && !t.completedAtMs ? <button className="soft-button" aria-label={'Add ' + t.title + ' to a course'} onClick={() => openNewWork(undefined, t)}>Add to course</button> : null,
  };
  return <TasksPage data={data} scope="school" startWithNew={startWithNew} onScope={onScope} save={save} remove={remove} complete={complete} extras={extras}/>;
}
