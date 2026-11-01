import { ChevronRight, Play, Plus } from 'lucide-react';
import { buildAgenda } from './domain/agenda';
import { formatDue, relativeDay } from './domain/format';
import { areaLabels, taskArea } from './domain/areas';
import type { Task, WorkspaceData } from './services/workspace';
import type { ChallengeData } from './services/challenges';
import type { ProjectsData } from './services/projects';
import type { AcademicData } from './services/academic';
import type { StudyBlock, StudyData } from './services/study';
import { agendaStudy, blockState, timeRange } from './domain/study';
import { Play as PlayIcon } from 'lucide-react';
import { contextLabel, courseworkItems, itemFor } from './domain/academic';
import type { PersonalData } from './services/personal';
import { prioritiesFor } from './domain/personal';
import { DailyPriorities } from './personal/DailyPriorities';
import { TodayHabits } from './personal/TodayHabits';
import type { PersonalOps, PersonalTab, Run } from './personal/shared';

function greeting(now: Date): string { const h = now.getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

interface Props {
  personal: PersonalData; personalOps: PersonalOps; run: Run; openPersonal: (tab: PersonalTab) => void; onProgress: () => void;
  name: string; academic: AcademicData; study: StudyData; openStudyBlock: (blockId: string) => void; startBlock: (block: StudyBlock) => void; openCoursework: (taskId: string) => void; data: WorkspaceData; projects: ProjectsData; challenges: ChallengeData;
  complete: (id: string, value: boolean) => Promise<void>;
  goTo: (page: string) => void; newTask: () => void; startFocus: (taskId: string | null) => void;
}
export function MyDay({ personal, personalOps, run, openPersonal, onProgress, name, academic, study, openStudyBlock, startBlock, openCoursework, data, projects, challenges, complete, goTo, newTask, startFocus }: Props) {
  const now = new Date();
  const coursework = courseworkItems(data.tasks, academic);
  const areaText = (t: Task) => contextLabel(itemFor(coursework, t.id)) || areaLabels[taskArea(t.category, Boolean(t.projectId))];
  const agenda = buildAgenda(data, projects, challenges, now);
  const dueNow: Task[] = [...agenda.overdue, ...agenda.todayTasks];
  // Tasks already shown under "Today's priorities" are not listed twice. A priority never changes when a task is due.
  const planned = new Set(prioritiesFor(agenda.today, personal.priorities, data.tasks).map(t => t.id));
  const unplanned = dueNow.filter(t => !planned.has(t.id));
  const remaining = dueNow.length;
  const total = remaining + agenda.doneToday;
  const dayStudy = agendaStudy(study, now);
  const courseCode = (id: string) => academic.courses.find(c => c.id === id)?.code ?? '';
  const nothingToday = !agenda.schedule.length && !remaining && !dayStudy.today.length;
  const row = (t: Task) => { const due = t.dueDate ? formatDue(t.dueDate, t.dueTime, now) : null; return <li key={t.id} className="day-row">
    <button className="task-check" aria-label={'Complete ' + t.title} onClick={() => void complete(t.id, true)}/>
    <span className="day-row-text"><strong>{t.title}</strong><small>{[itemFor(coursework, t.id) ? <button key="course" className="context-link" aria-label={'Open ' + t.title + ' in ' + itemFor(coursework, t.id)!.course.code} onClick={() => openCoursework(t.id)}>{areaText(t)}</button> : areaText(t), due && (due.overdue ? due.text : t.dueTime ? 'at ' + t.dueTime : ''), t.priority === 'high' ? 'High priority' : ''].filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x])}</small></span>
    {due?.overdue && <span className="tag overdue">Overdue</span>}
  </li>; };
  return <div className="myday">
    <header className="day-head">
      <div><h1>{greeting(now)}, {name.split(' ')[0]}</h1><p>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
      <button className="soft-button" onClick={newTask}><Plus size={15}/> New task</button>
    </header>
    <section className="next-up" aria-label="What to focus on next">
      <div><span className="label">Next up</span><strong>{agenda.next ? agenda.next.title : 'Nothing queued'}</strong><small>{agenda.next ? [agenda.next.dueDate ? formatDue(agenda.next.dueDate, agenda.next.dueTime, now).text : 'No due date', areaText(agenda.next)].join(' · ') : 'Add a task, or start a focus session whenever you are ready.'}</small></div>
      <button className="primary-button" onClick={() => startFocus(agenda.next?.id ?? null)}><Play size={15}/> Start focus</button>
    </section>
    <div className="day-grid">
      <section aria-labelledby="today-heading">
        <h2 id="today-heading">Today</h2>
        {nothingToday ? <p className="quiet-note">Nothing scheduled and nothing due. {total > 0 ? 'Everything planned for today is done.' : 'Enjoy the open space.'}</p>
          : <>{agenda.schedule.length > 0 && <ul className="day-list" aria-label="Today's schedule">{agenda.schedule.map(e => <li key={e.key} className="day-row event"><span className="day-time">{e.time ?? 'All day'}</span><span className="day-row-text"><strong>{e.title}</strong>{e.time && <small>{e.note}</small>}</span></li>)}</ul>}
            {unplanned.length > 0 && <ul className="day-list" aria-label="Tasks for today">{unplanned.map(row)}</ul>}
            {dayStudy.today.length > 0 && <ul className="day-list" aria-label="Study blocks today">{dayStudy.today.map(b => { const missed = blockState(b, study.sessions, now) === 'missed'; const label = b.title || 'Study session';
              return <li key={b.id} className="day-row study"><span className="day-time">{b.startTime}</span><span className="day-row-text"><strong>{label}</strong><small><button className="context-link" aria-label={'Open study block ' + label} onClick={() => openStudyBlock(b.id)}>{'Study · ' + courseCode(b.courseId)}</button>{' · ' + timeRange(b) + (missed ? ' · Earlier today' : '')}</small></span>
                <button className="soft-button" aria-label={'Start studying ' + label} onClick={() => startBlock(b)}><PlayIcon size={13}/> Start</button></li>; })}</ul>}</>}
        <DailyPriorities tasks={data.tasks} personal={personal} today={agenda.today} ops={personalOps} run={run} complete={complete} startFocus={id => startFocus(id)} newTask={newTask} label="Today's priorities"/>
        {total > 0 && <div className="day-progress" aria-label="Today's progress"><progress max={total} value={agenda.doneToday} aria-label="Tasks completed today"/><span>{agenda.doneToday} of {total} done{agenda.focusMinutesToday > 0 ? ' · ' + agenda.focusMinutesToday + ' min focused' : ''}</span></div>}
        {total === 0 && agenda.focusMinutesToday > 0 && <p className="quiet-note">{agenda.focusMinutesToday} min focused today.</p>}
        <button className="text-link" onClick={() => goTo('Tasks')}>All tasks <ChevronRight size={13}/></button>
      </section>
      <aside>
        <section aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">Coming up</h2>
          {(agenda.upcoming.length || dayStudy.coming.length) ? <ul className="day-list">{[...agenda.upcoming.map(u => ({ ...u, study: false as const, sort: u.date + ' ' + (u.time ?? '') })), ...dayStudy.coming.map(b => ({ key: 's' + b.id, kind: 'study' as const, title: b.title || 'Study · ' + courseCode(b.courseId), date: b.startDate, time: b.startTime, note: timeRange(b), taskId: undefined, study: true as const, sort: b.startDate + ' ' + b.startTime }))].sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 6).map(u => u.study ? <li key={u.key} className="day-row study"><span className="day-time">{relativeDay(u.date, now)}</span><span className="day-row-text"><strong>{u.title}</strong><small>{'Study · ' + u.note}</small></span></li> : <li key={u.key} className="day-row"><span className="day-time">{relativeDay(u.date, now)}</span><span className="day-row-text"><strong>{u.title}</strong>{(u.kind === 'challenge' || u.kind === 'milestone') ? <small>{u.note}</small> : (u.taskId && itemFor(coursework, u.taskId)) || u.time ? <small>{[u.taskId ? contextLabel(itemFor(coursework, u.taskId)) : '', u.time].filter(Boolean).join(' · ')}</small> : null}</span></li>)}</ul>
            : <p className="quiet-note">Nothing due in the next week.</p>}
          <button className="text-link" onClick={() => goTo('Calendar')}>Open calendar <ChevronRight size={13}/></button>
        </section>
        <TodayHabits personal={personal} today={agenda.today} ops={personalOps} run={run} onProgress={onProgress} openPersonal={openPersonal} headingId="habits-heading"/>
        {agenda.activeChallenge && <section aria-labelledby="eng-heading">
          <h2 id="eng-heading">In progress</h2>
          <button className="inline-card" onClick={() => goTo('Weekly Challenges')}><span><strong>{agenda.activeChallenge.title}</strong><small>Engineering challenge · {agenda.activeChallenge.checks}/{agenda.activeChallenge.total} checks{agenda.activeChallenge.checks >= agenda.activeChallenge.total ? ' · ready to mark completed' : ''}</small></span><ChevronRight size={16}/></button>
        </section>}
      </aside>
    </div>
  </div>;
}
