import { Star } from 'lucide-react';
import { TasksPage, type TaskScope } from './ProductivityPages';
import type { Task, TaskInput, WorkspaceData } from './services/workspace';
import type { PersonalData } from './services/personal';
import { describeRule, occurrenceRuleByTask, prioritiesFor, weeklyReview } from './domain/personal';
import { TodayHabits } from './personal/TodayHabits';
import { GoalsView } from './personal/GoalsView';
import { HabitsView } from './personal/HabitsView';
import { RoutinesView } from './personal/RoutinesView';
import { WeekView } from './personal/WeekView';
import { DailyPriorities } from './personal/DailyPriorities';
import { RecurringSection } from './personal/RecurringSection';
import type { PersonalOps, PersonalTab, Run } from './personal/shared';
import { plural } from './personal/format';

const tabLabels: Record<PersonalTab, string> = { overview: 'Overview', goals: 'Goals', habits: 'Habits', routines: 'Routines', week: 'Week' };
const blurbs: Record<Exclude<PersonalTab, 'overview'>, string> = {
  goals: 'Outcomes you measure: finish something, reach a total, or repeat a target.',
  habits: 'Things you repeat. Check them in; missed days never count as done.',
  routines: 'Ordered checklists you run again and again. Each run is saved on its own day.',
  week: 'A short look back at the week, counted from what you actually did.',
};

export interface PersonalPageProps {
  data: WorkspaceData; personal: PersonalData; today: string; tab: PersonalTab; onTab: (tab: PersonalTab) => void;
  ops: PersonalOps; run: Run;
  startWithNew: boolean; onScope: (scope: TaskScope) => void;
  save: (task: TaskInput) => Promise<boolean>; remove: (id: string) => Promise<void>; complete: (id: string, value: boolean) => Promise<void>;
  startFocus: (taskId: string) => void;
  /** A quiet Pip reaction (no XP) after finishing a routine or checking in a habit. */
  onProgress: () => void;
}

export function PersonalPage(p: PersonalPageProps) {
  const { data, personal, today, tab, onTab, ops, run } = p;
  const tabs = <div className="segmented personal-views" role="group" aria-label="Personal view">{(Object.keys(tabLabels) as PersonalTab[]).map(t => <button key={t} className={tab === t ? 'active' : ''} aria-pressed={tab === t} onClick={() => onTab(t)}>{tabLabels[t]}</button>)}</div>;
  if (tab !== 'overview') {
    return <div className="page-panel wide-panel"><div className="page-head"><div><h1>Personal</h1><p>{blurbs[tab]}</p></div></div>{tabs}
      {tab === 'goals' && <GoalsView data={personal} today={today} ops={ops} run={run}/>}
      {tab === 'habits' && <HabitsView data={personal} today={today} ops={ops} run={run} onCheckin={p.onProgress}/>}
      {tab === 'routines' && <RoutinesView data={personal} today={today} ops={ops} run={run} onDone={p.onProgress}/>}
      {tab === 'week' && <WeekView personal={personal} tasks={data.tasks} today={today}/>}
    </div>;
  }
  const ruleByTask = occurrenceRuleByTask(personal.occurrences, personal.rules);
  const planned = new Set(prioritiesFor(today, personal.priorities, data.tasks).map(t => t.id));
  const togglePriority = (t: Task) => { const ids = prioritiesFor(today, personal.priorities, data.tasks).map(x => x.id); void run(() => ops.setDailyPriorities(today, planned.has(t.id) ? ids.filter(x => x !== t.id) : [...ids, t.id], today)); };
  return <TasksPage data={data} scope="personal" startWithNew={p.startWithNew} onScope={p.onScope} save={p.save} remove={p.remove} complete={p.complete} extras={{
    tabs,
    listHeading: 'Tasks',
    above: <Overview {...p}/>,
    rowExtra: t => { const rule = ruleByTask.get(t.id); return <>
      {rule && <span className="tag" title={describeRule(rule)}>Repeats</span>}
      {!t.completedAtMs && <button className={'icon-button priority-toggle' + (planned.has(t.id) ? ' on' : '')} aria-label={'Today\'s priority: ' + t.title} aria-pressed={planned.has(t.id)} title={planned.has(t.id) ? 'Remove from today\'s priorities' : 'Make this one of today\'s priorities'} onClick={() => togglePriority(t)}><Star size={16} fill={planned.has(t.id) ? 'currentColor' : 'none'}/></button>}
      {rule && !t.completedAtMs && <button className="soft-button" aria-label={'Skip ' + t.title} title="Skip this occurrence; it will not count as done" onClick={() => void run(() => ops.skipOccurrence(t.id))}>Skip</button>}
    </>; },
  }}/>;
}

function Overview({ data, personal, today, ops, run, onTab, complete, startFocus, onProgress }: PersonalPageProps) {
  const week = weeklyReview(today, personal, data.tasks, today);
  const habitsDone = week.habits.reduce((n, h) => n + h.done, 0); const habitsExpected = week.habits.reduce((n, h) => n + h.expected, 0);
  const activeGoals = personal.goals.filter(g => g.status === 'active').length;
  return <div className="personal-overview">
    <DailyPriorities tasks={data.tasks} personal={personal} today={today} ops={ops} run={run} complete={complete} startFocus={startFocus}/>
    <TodayHabits personal={personal} today={today} ops={ops} run={run} onProgress={onProgress} openPersonal={onTab} headingId="ov-habits-heading"/>
    <p className="quiet-note overview-summary" aria-label="Progress this week">This week: {plural(week.tasksCompleted, 'task')} done
      {habitsExpected > 0 ? ` · habits ${habitsDone} of ${habitsExpected}` : ''}{week.routines.completed ? ` · ${plural(week.routines.completed, 'routine')} finished` : ''}{activeGoals ? ` · ${plural(activeGoals, 'active goal')}` : ''}. <button className="text-link inline-link" onClick={() => onTab('week')}>Weekly review</button></p>
    <RecurringSection personal={personal} tasks={data.tasks} today={today} ops={ops} run={run}/>
  </div>;
}
