import { ChevronRight, Play, Plus } from 'lucide-react';
import { buildAgenda } from './domain/agenda';
import { formatDue, relativeDay } from './domain/format';
import { areaLabels, taskArea } from './domain/areas';
import type { Task, WorkspaceData } from './services/workspace';
import type { ChallengeData } from './services/challenges';
import type { ProjectsData } from './services/projects';
import type { AcademicData } from './services/academic';
import { contextLabel, courseworkItems, itemFor } from './domain/academic';

function greeting(now: Date): string { const h = now.getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

interface Props {
  name: string; academic: AcademicData; openCoursework: (taskId: string) => void; data: WorkspaceData; projects: ProjectsData; challenges: ChallengeData;
  complete: (id: string, value: boolean) => Promise<void>;
  goTo: (page: string) => void; newTask: () => void; startFocus: (taskId: string | null) => void;
}
export function MyDay({ name, academic, openCoursework, data, projects, challenges, complete, goTo, newTask, startFocus }: Props) {
  const now = new Date();
  const coursework = courseworkItems(data.tasks, academic);
  const areaText = (t: Task) => contextLabel(itemFor(coursework, t.id)) || areaLabels[taskArea(t.category, Boolean(t.projectId))];
  const agenda = buildAgenda(data, projects, challenges, now);
  const dueNow: Task[] = [...agenda.overdue, ...agenda.todayTasks];
  const remaining = dueNow.length;
  const total = remaining + agenda.doneToday;
  const nothingToday = !agenda.schedule.length && !remaining;
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
        {nothingToday ? <p className="quiet-note">Nothing scheduled and nothing due. {total > 0 ? 'Everything planned for today is done.' : 'Enjoy the open space, or plan something.'}</p>
          : <>{agenda.schedule.length > 0 && <ul className="day-list" aria-label="Today's schedule">{agenda.schedule.map(e => <li key={e.key} className="day-row event"><span className="day-time">{e.time ?? 'All day'}</span><span className="day-row-text"><strong>{e.title}</strong>{e.time && <small>{e.note}</small>}</span></li>)}</ul>}
            {remaining > 0 && <ul className="day-list" aria-label="Tasks for today">{dueNow.map(row)}</ul>}</>}
        {total > 0 && <div className="day-progress" aria-label="Today's progress"><progress max={total} value={agenda.doneToday} aria-label="Tasks completed today"/><span>{agenda.doneToday} of {total} done{agenda.focusMinutesToday > 0 ? ' · ' + agenda.focusMinutesToday + ' min focused' : ''}</span></div>}
        {total === 0 && agenda.focusMinutesToday > 0 && <p className="quiet-note">{agenda.focusMinutesToday} min focused today.</p>}
        <button className="text-link" onClick={() => goTo('Tasks')}>All tasks <ChevronRight size={13}/></button>
      </section>
      <aside>
        <section aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">Coming up</h2>
          {agenda.upcoming.length ? <ul className="day-list">{agenda.upcoming.slice(0, 6).map(u => <li key={u.key} className="day-row"><span className="day-time">{relativeDay(u.date, now)}</span><span className="day-row-text"><strong>{u.title}</strong>{(u.kind === 'challenge' || u.kind === 'milestone') ? <small>{u.note}</small> : (u.taskId && itemFor(coursework, u.taskId)) || u.time ? <small>{[u.taskId ? contextLabel(itemFor(coursework, u.taskId)) : '', u.time].filter(Boolean).join(' · ')}</small> : null}</span></li>)}</ul>
            : <p className="quiet-note">Nothing due in the next week.</p>}
          <button className="text-link" onClick={() => goTo('Calendar')}>Open calendar <ChevronRight size={13}/></button>
        </section>
        {agenda.activeChallenge && <section aria-labelledby="eng-heading">
          <h2 id="eng-heading">In progress</h2>
          <button className="inline-card" onClick={() => goTo('Weekly Challenges')}><span><strong>{agenda.activeChallenge.title}</strong><small>Engineering challenge · {agenda.activeChallenge.checks}/{agenda.activeChallenge.total} checks</small></span><ChevronRight size={16}/></button>
        </section>}
      </aside>
    </div>
  </div>;
}
