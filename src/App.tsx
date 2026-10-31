import { useEffect, useRef, useState } from 'react';
import { Bell, BookOpen, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Compass, FolderKanban, GraduationCap, Home, Lightbulb, Menu, Moon, Settings2, Sparkles, Target, X, Timer, Award, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppSnapshot, Engagement } from './domain/types';
import { transitionPip } from './domain/pip';
import type { PipEvent } from './domain/pip';
import { loadSnapshot, saveSnapshot } from './services/storage';
import { deleteTask, equipCosmetic, focusAction, loadWorkspace, saveTask, setFocusDefaults, setTaskCompleted, type TaskInput, type WorkspaceData } from './services/workspace';
import { AchievementsPage, CustomizationPage, DashboardProductivity, FocusPage, TasksPage } from './ProductivityPages';
import { CalendarPage } from './CalendarPage';
import { NotificationsPage } from './NotificationsPage';
import { claimReminder, deleteEvent, inQuietHours, reminderCandidates, saveEvent, saveReminderPreferences } from './services/calendar';
import { PipIllustration } from './components/PipIllustration';
import { Button } from './components/ui/button';
import { ProjectsPage } from './ProjectsPage';
import { ChallengesPage } from './ChallengesPage';
import { addChallengeEvidence, assignWeek, challengeAction, createChallengeProject, linkChallengeProject, loadChallenges, removeChallengeEvidence, saveChallengeSettings, skillProgress, weekStart, type ChallengeData } from './services/challenges';
import { associateTask, deleteProjectItem, loadProjects, openProjectFile, saveJournalEntry, saveMilestone, saveProject, saveProjectFile, setMilestoneCompleted, type ProjectsData } from './services/projects';

type Destination = { label: string; icon: LucideIcon };
const groups: { name: string; items: Destination[] }[] = [
  { name: 'Home', items: [{ label: 'Dashboard', icon: Home }, { label: 'Calendar', icon: CalendarDays }, { label: 'Notifications', icon: Bell }] },
  { name: 'Productivity', items: [{ label: 'Tasks', icon: Target }, { label: 'Focus Sessions', icon: Timer }, { label: 'Goals', icon: Sparkles }, { label: 'Habits', icon: Compass }] },
  { name: 'Engineering', items: [{ label: 'Projects', icon: FolderKanban }, { label: 'Weekly Challenges', icon: Lightbulb }, { label: 'Skills', icon: Target }, { label: 'Engineering Journal', icon: BookOpen }] },
  { name: 'Academics', items: [{ label: 'Courses', icon: GraduationCap }, { label: 'Assignments', icon: BookOpen }, { label: 'Grades', icon: Target }] },
  { name: 'Knowledge', items: [{ label: 'Notes', icon: BookOpen }, { label: 'Knowledge Map', icon: Compass }] },
  { name: 'Portfolio', items: [{ label: 'Portfolio Manager', icon: FolderKanban }, { label: 'Project Gallery', icon: Sparkles }, { label: 'Exports', icon: Compass }] },
  { name: 'Companion', items: [{ label: 'Pip', icon: Sparkles }, { label: 'Customization', icon: Palette }, { label: 'Achievements', icon: Award }] },
  { name: 'Insights', items: [{ label: 'Analytics', icon: Target }, { label: 'Progress Reports', icon: BookOpen }] },
  { name: 'System', items: [{ label: 'Settings', icon: Settings2 }, { label: 'Integrations', icon: Compass }, { label: 'Backup and Restore', icon: FolderKanban }, { label: 'About and Updates', icon: CircleHelp }] },
];
function Onboarding({ onDone }: { onDone: (name: string, visible: boolean, engagement: Engagement) => void }) {
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(true);
  const [engagement, setEngagement] = useState<Engagement>('balanced');
  return <main className="onboarding"><div className="onboarding-card"><div className="brand-mark">C</div><span className="eyebrow">WELCOME TO YOUR WORKSPACE</span><h1>Make room for the work<br/><em>that matters.</em></h1><p>CivilDesk brings your engineering journey into one quiet, personal space. Everything starts here, on your computer.</p><form onSubmit={e => { e.preventDefault(); if (name.trim()) onDone(name.trim(), visible, engagement); }}><label htmlFor="display-name">What should we call you?</label><input id="display-name" autoFocus maxLength={60} required placeholder="Your first name" value={name} onChange={e => setName(e.target.value)}/><div className="onboarding-choice"><div><strong>Rosewood appearance</strong><small>A warm, focused space for your work</small></div><span className="theme-swatch" aria-label="Rosewood selected"/></div><label className="onboarding-choice check-row"><span><strong>Meet Pip</strong><small>A small companion for your desk</small></span><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}/></label>{visible && <><label htmlFor="engagement">Pip's presence</label><select id="engagement" value={engagement} onChange={e => setEngagement(e.target.value as Engagement)}><option value="quiet">Quiet · only when invited</option><option value="balanced">Balanced · occasional reactions</option><option value="playful">Playful · a little more expressive</option></select></>}<Button className="primary-button" type="submit">Enter CivilDesk <ChevronRight size={17}/></Button></form><small className="footnote">No account or internet connection required.</small></div></main>;
}
function PipCard({ snapshot, data, onPip, onHide }: { snapshot: AppSnapshot; data: WorkspaceData; onPip: (event: PipEvent) => void; onHide: () => void }) {
  const { companion, preferences } = snapshot;
  const sleeping = companion.state === 'sleeping';
  const progress = data.progression;
  return <section className="pip-card" aria-label="Pip companion"><div className="card-heading"><div><span className="eyebrow">YOUR DESK COMPANION</span><h2>Say hello to Pip</h2></div><button className="icon-button" aria-label="Hide Pip" title="Hide Pip" onClick={onHide}><X size={17}/></button></div><button className="pip-interaction" onClick={() => onPip(sleeping ? 'WAKE' : 'PET')} aria-label={sleeping ? 'Wake Pip' : 'Pet Pip'}><PipIllustration state={companion.state} reducedMotion={preferences.reducedMotion} styleId={progress.styleId} scarf={progress.scarf} headphones={progress.headphones} aura={progress.earned.includes('level_five')}/></button><div className="pip-caption">{sleeping ? 'Pip is resting. Wake them when you like.' : companion.state === 'focused' ? 'Pip is keeping you company quietly.' : companion.state === 'affectionate' ? 'Pip likes having you around.' : companion.state === 'curious' ? 'Pip is ready to explore with you.' : 'Pip is here when you need a little company.'}</div><div className="pip-actions"><button onClick={() => onPip(sleeping ? 'WAKE' : 'REST')} className="soft-button"><Moon size={15}/>{sleeping ? 'Wake Pip' : 'Let Pip rest'}</button><button onClick={() => onPip('EXPLORE')} className="soft-button" disabled={sleeping || preferences.focusMode}><Sparkles size={15}/>Explore</button></div><div className="pip-level">Level {progress.level} · {progress.xp} XP</div></section>;
}
function Dashboard({ snapshot, data, challenges, onPip, onHide, goTo }: { snapshot: AppSnapshot; data: WorkspaceData; challenges: ChallengeData; onPip: (event: PipEvent) => void; onHide: () => void; goTo: (page: string) => void }) {
  const first = snapshot.preferences.displayName.split(' ')[0];
  return <><div className="hero"><span className="eyebrow">YOUR PERSONAL WORKSPACE</span><h1>Good to have you here, {first}.</h1><p>Every meaningful project starts with a clear space. Settle in and make this one yours.</p><div className="hero-line"/></div><div className="dashboard-grid"><section className="welcome-card"><div className="card-heading"><div><span className="eyebrow">YOUR NEXT STEP</span><h2>Make today count, at your pace</h2></div><span className="step-pill">LOCAL WORKSPACE</span></div><p>{data.tasks.filter(t => !t.completedAtMs).length ? 'Your open tasks are ready when you are.' : 'A clear space is a good start. Add your first task or settle into a focus session.'}</p><div className="start-list"><div><span>01</span><div><strong>Plan a task</strong><small>Capture a concrete next step</small></div><button onClick={() => goTo('Tasks')} aria-label="Open tasks"><ChevronRight size={18}/></button></div><div><span>02</span><div><strong>Begin focus</strong><small>Protect time for meaningful work</small></div><button onClick={() => goTo('Focus Sessions')} aria-label="Open focus sessions"><ChevronRight size={18}/></button></div><div><span>03</span><div><strong>See your progress</strong><small>Review achievements you have earned</small></div><button onClick={() => goTo('Achievements')} aria-label="Open achievements"><ChevronRight size={18}/></button></div></div></section>{snapshot.preferences.pipVisible && snapshot.preferences.dashboardPipEnabled ? <PipCard snapshot={snapshot} data={data} onPip={onPip} onHide={onHide}/> : <section className="pip-card hidden-pip"><Sparkles size={28}/><h2>Pip is taking a break</h2><p>You can bring Pip back in Settings whenever you like.</p><button className="soft-button" onClick={() => goTo('Settings')}>Open settings</button></section>}</div><section className="info-card dashboard-challenges"><div className="page-head"><div><span className="eyebrow">ENGINEERING LEARNING</span><h2>This week's challenges</h2></div><button className="soft-button" onClick={()=>goTo('Weekly Challenges')}>Open board</button></div>{challenges.assignments.filter(a=>a.weekStart===weekStart()).length ? <ul className="simple-list">{challenges.assignments.filter(a=>a.weekStart===weekStart()).slice(0,3).map(a=>{const c=challenges.challenges.find(x=>x.id===a.challengeId);const p=challenges.progress.find(x=>x.challengeId===a.challengeId);return <li key={a.id}><span>{c?.title||a.challengeId}<small>{a.status} · {p?.checks.length||0}/{c?.checklist.length||0} checks</small></span></li>})}</ul> : <p>Choose a challenge when you are ready.</p>}<div className="button-row"><small>{challenges.progress.filter(p=>p.deadlineDate&&p.status!=='Completed').sort((a,b)=>(a.deadlineDate||'').localeCompare(b.deadlineDate||''))[0]?.deadlineDate ? 'Next challenge deadline: '+challenges.progress.filter(p=>p.deadlineDate&&p.status!=='Completed').sort((a,b)=>(a.deadlineDate||'').localeCompare(b.deadlineDate||''))[0]?.deadlineDate : 'No challenge deadlines set'}</small><small>{skillProgress(challenges).filter(x=>x.completed>0).slice(0,2).map(x=>x.id+' '+x.completed+'/'+x.total).join(' · ')}</small></div></section><DashboardProductivity data={data} goTo={goTo}/></>;
}
function Settings({ snapshot, update }: { snapshot: AppSnapshot; update: (next: AppSnapshot) => void }) {
  const p = snapshot.preferences;
  const set = (patch: Partial<typeof p>) => update({ ...snapshot, preferences: { ...p, ...patch }, companion: patch.focusMode === undefined ? snapshot.companion : { ...snapshot.companion, state: patch.focusMode ? 'focused' : 'relaxed' } });
  return <div className="page-panel"><span className="eyebrow">SYSTEM</span><h1>Settings</h1><p>Choose how CivilDesk feels and how Pip shares your space.</p><div className="setting-group"><h2>Profile</h2><label htmlFor="settings-name">Display name</label><input id="settings-name" value={p.displayName} maxLength={60} onChange={e => set({ displayName: e.target.value })}/></div><div className="setting-group"><h2>Companion</h2><label className="setting-row"><span><strong>Show Pip</strong><small>Display Pip in the dashboard and companion view</small></span><input type="checkbox" checked={p.pipVisible} onChange={e => set({ pipVisible: e.target.checked })}/></label><label className="setting-row"><span><strong>Dashboard widget</strong><small>Keep Pip's card on the dashboard</small></span><input type="checkbox" checked={p.dashboardPipEnabled} onChange={e => set({ dashboardPipEnabled: e.target.checked })}/></label><label htmlFor="engagement-setting">Engagement level</label><select id="engagement-setting" value={p.engagement} onChange={e => set({ engagement: e.target.value as Engagement })}><option value="quiet">Quiet</option><option value="balanced">Balanced</option><option value="playful">Playful</option></select><label className="setting-row"><span><strong>Focus mode</strong><small>Suppress decorative reactions</small></span><input type="checkbox" checked={p.focusMode} onChange={e => set({ focusMode: e.target.checked })}/></label><label className="setting-row"><span><strong>Reduced motion</strong><small>Keep Pip still and minimize interface transitions</small></span><input type="checkbox" checked={p.reducedMotion} onChange={e => set({ reducedMotion: e.target.checked })}/></label></div></div>;
}
export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [projects, setProjects] = useState<ProjectsData | null>(null);
  const [challenges, setChallenges] = useState<ChallengeData | null>(null);
  const [page, setPage] = useState('Dashboard');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reminderAlert, setReminderAlert] = useState('');
  const attemptedWeek = useRef('');
  useEffect(() => { Promise.all([loadSnapshot(), loadWorkspace(), loadProjects(), loadChallenges()]).then(([s, w, p, c]) => { setSnapshot(s); setWorkspace(w); setProjects(p); setChallenges(c); }).catch(e => setError(String(e))); }, []);
  useEffect(() => { document.documentElement.classList.toggle('reduced-motion', !!snapshot?.preferences.reducedMotion); }, [snapshot?.preferences.reducedMotion]);
  useEffect(() => {
    if (!workspace || !workspace.reminderPreferences.enabled) return;
    let disposed = false;
    async function check() {
      if (!workspace || !workspace.reminderPreferences.enabled || workspace.sessions.some(s => s.status === 'running')) return;
      const now = new Date();
      if (inQuietHours(now, workspace.reminderPreferences)) return;
      const due = reminderCandidates(workspace, now.getTime()).filter(x => x.scheduledAtMs <= now.getTime() && x.dueAtMs >= now.getTime() - 7 * 24 * 60 * 60_000);
      const claimed = [];
      for (const item of due) {
        try { if (await claimReminder(item.kind, item.id, item.scheduledAtMs)) claimed.push(item); }
        catch (e) { if (!disposed) setError('Could not check reminders: ' + String(e)); }
      }
      if (!disposed && claimed.length) setReminderAlert(claimed.length === 1 ? 'Reminder: ' + claimed[0]?.title : claimed.length + ' reminders are ready in Notifications.');
    }
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [workspace]);
  async function update(next: AppSnapshot) { setSnapshot(next); setSaving(true); try { await saveSnapshot(next); setError(''); } catch (e) { setError('Could not save your changes: ' + String(e)); } finally { setSaving(false); } }
  async function mutate(operation: () => Promise<void>): Promise<boolean> {
    setSaving(true);
    try { await operation(); const [w,p] = await Promise.all([loadWorkspace(),loadProjects()]); setWorkspace(w); setProjects(p); setError(''); return true; }
    catch (e) { setError('Could not save your changes: ' + String(e)); return false; }
    finally { setSaving(false); }
  }
  useEffect(() => { if (!challenges?.settings.automatic) return; const week=weekStart(); if (attemptedWeek.current===week) return; attemptedWeek.current=week; void assignWeek(week).then(()=>loadChallenges()).then(setChallenges).catch(e=>setError(String(e))); }, [challenges]);
  const focusActive = !!workspace?.sessions.some(s => s.status === 'running');
  function pip(event: PipEvent, forceFocus = focusActive) {
    if (!snapshot) return;
    const result = transitionPip(snapshot.companion.state, event, { focusMode: snapshot.preferences.focusMode || forceFocus, engagement: snapshot.preferences.engagement, lastReactionAt: new Date(snapshot.companion.updatedAt).getTime(), now: Date.now() });
    void update({ ...snapshot, companion: { ...snapshot.companion, state: result.state, updatedAt: new Date(result.lastReactionAt).toISOString() } });
  }
  async function completeTask(id: string, value: boolean) {
    const previous = workspace?.progression.history.length || 0;
    if (await mutate(() => setTaskCompleted(id, value)) && value && !focusActive) {
      const refreshed = await loadWorkspace();
      if (refreshed.progression.history.length > previous) pip('TASK_COMPLETED');
    }
  }
  async function actFocus(action: 'start' | 'pause' | 'resume' | 'stop' | 'complete', id: string, taskId: string | null = null, duration = 0, breakMinutes = 0) {
    if (await mutate(() => focusAction(action, id, taskId, duration, breakMinutes))) {
      if (action === 'start' || action === 'resume') pip('FOCUS_START', false);
      if (action === 'stop') pip('FOCUS_END', false);
      if (action === 'complete') pip('TASK_COMPLETED', false);
    }
  }
  if (error && !snapshot) return <div className="fatal"><h1>CivilDesk could not open</h1><p>{error}</p><button onClick={() => window.location.reload()}>Try again</button></div>;
  if (!snapshot || !workspace || !projects || !challenges) return <div className="loading">Opening CivilDesk…</div>;
  if (!snapshot.preferences.onboardingComplete) return <>{error && <div role="alert" className="error-banner">{error}</div>}<Onboarding onDone={(name, visible, engagement) => void update({ ...snapshot, preferences: { ...snapshot.preferences, displayName: name, pipVisible: visible, engagement, onboardingComplete: true } })}/></>;
  const collapsed = snapshot.preferences.sidebarCollapsed;
  return <div className="shell"><aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}><div className="sidebar-top"><div className="brand"><span className="brand-mark small">C</span><span className="brand-name">CivilDesk<small>YOUR WORKSPACE</small></span></div><button className="icon-button collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, sidebarCollapsed: !collapsed } })}>{collapsed ? <Menu size={18}/> : <ChevronLeft size={18}/>}</button></div><nav aria-label="Main navigation">{groups.map(group => <div className="nav-group" key={group.name}><div className="nav-heading">{group.name}</div>{group.items.map(item => <button title={item.label} key={item.label} className={'nav-item ' + (page === item.label ? 'active' : '')} aria-current={page === item.label ? 'page' : undefined} onClick={() => setPage(item.label)}><item.icon size={17} strokeWidth={1.8}/><span>{item.label}</span></button>)}</div>)}</nav><div className="sidebar-bottom"><span className="avatar">{snapshot.preferences.displayName.charAt(0).toUpperCase() || 'C'}</span><span className="account-name">{snapshot.preferences.displayName}<small>Local workspace</small></span></div></aside><main className="main"><header className="topbar"><div className="breadcrumb">CivilDesk <ChevronRight size={14}/> <strong>{page}</strong></div><div className="top-actions">{saving && <span className="save-status">Saving…</span>}<span className="local-badge">LOCAL FIRST</span><button className="icon-button" aria-label="Open settings" onClick={() => setPage('Settings')}><Settings2 size={18}/></button></div></header>{error && <div role="alert" className="error-banner">{error}</div>}{reminderAlert && <div className="reminder-banner" role="status"><span>{reminderAlert}</span><button aria-label="Dismiss reminder" onClick={() => setReminderAlert('')}>Dismiss</button></div>}<div className="content">
    {page === 'Dashboard' ? <Dashboard snapshot={snapshot} data={workspace} challenges={challenges!} onPip={pip} onHide={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, pipVisible: false } })} goTo={setPage}/>
      : page === 'Calendar' ? <CalendarPage data={workspace} projects={projects} challenges={challenges} save={async event => mutate(() => saveEvent(event))} remove={async id => { await mutate(() => deleteEvent(id)); }}/>
      : page === 'Notifications' ? <NotificationsPage data={workspace} save={async prefs => { await mutate(() => saveReminderPreferences(prefs)); }}/>
      : page === 'Weekly Challenges' || page === 'Skills' ? <ChallengesPage key={page} initialTab={page === 'Skills' ? 'skills' : 'board'} data={challenges!} projects={projects} refresh={async()=>{const [c,p]=await Promise.all([loadChallenges(),loadProjects()]);setChallenges(c);setProjects(p)}} saveSettings={saveChallengeSettings} assign={assignWeek} act={async(id,action,options)=>{await challengeAction(id,action,options);if(action==='complete'&&challenges.progress.find(p=>p.challengeId===id)?.status!=='Completed')pip('ENGINEERING_ACCOMPLISHMENT')}} evidence={addChallengeEvidence} removeEvidence={removeChallengeEvidence} link={linkChallengeProject} createProject={async id=>{const existing=challenges.projects.some(p=>p.challengeId===id&&p.createdFromChallenge);await createChallengeProject(id);if(!existing)pip('ENGINEERING_ACCOMPLISHMENT')}}/>
      : page === 'Tasks' ? <TasksPage data={workspace} save={async (task: TaskInput) => mutate(() => saveTask(task))} remove={async id => { await mutate(() => deleteTask(id)); }} complete={completeTask}/>
      : page === 'Projects' || page === 'Engineering Journal' ? <ProjectsPage data={projects} workspace={workspace} saveProject={p=>mutate(()=>saveProject(p))} saveMilestone={m=>mutate(()=>saveMilestone(m))} completeMilestone={async(id,value)=>{await mutate(()=>setMilestoneCompleted(id,value))}} deleteItem={async(kind,id)=>{await mutate(()=>deleteProjectItem(kind,id))}} associateTask={async(taskId,projectId)=>{await mutate(()=>associateTask(taskId,projectId))}} saveTask={t=>mutate(()=>saveTask(t))} completeTask={completeTask} saveFile={f=>mutate(()=>saveProjectFile(f))} openFile={async id=>{try{await openProjectFile(id)}catch(e){setError(String(e))}}} saveJournal={j=>mutate(()=>saveJournalEntry(j))}/>
      : page === 'Focus Sessions' ? <FocusPage data={workspace} defaults={async (d, b) => mutate(() => setFocusDefaults(d, b))} action={actFocus}/>
      : page === 'Settings' ? <Settings snapshot={snapshot} update={next => void update(next)}/>
      : page === 'Pip' ? <div className="page-panel"><span className="eyebrow">COMPANION</span><h1>Pip</h1><p>A gentle presence for your workday. Pip follows your pace.</p>{snapshot.preferences.pipVisible ? <div className="pip-page"><PipCard snapshot={snapshot} data={workspace} onPip={pip} onHide={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, pipVisible: false } })}/></div> : <button className="primary-button" onClick={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, pipVisible: true } })}>Show Pip</button>}</div>
      : page === 'Customization' ? <CustomizationPage data={workspace} state={snapshot.companion.state} reducedMotion={snapshot.preferences.reducedMotion} equip={async (id, equipped) => { await mutate(() => equipCosmetic(id, equipped)); }}/>
      : page === 'Achievements' ? <AchievementsPage data={workspace}/>
      : page === 'About and Updates' ? <div className="page-panel"><span className="eyebrow">CIVILDESK</span><h1>About CivilDesk</h1><p>A local-first workspace for engineering work and personal progress.</p><div className="roadmap"><h2>What works today</h2><p>Onboarding, tasks, calendar, engineering projects, weekly challenges, skills, focus sessions, Pip progression, and preferences.</p><h2>What comes next</h2><p>Academics, Portfolio Studio, and new Pip engineering cosmetics arrive in later milestones.</p></div></div>
      : <div className="page-panel placeholder"><span className="eyebrow">COMING IN A FUTURE MILESTONE</span><h1>{page}</h1><p>This area is part of the CivilDesk roadmap. It does not store or manage data yet.</p><button className="soft-button" onClick={() => setPage('Dashboard')}>Back to dashboard <ChevronRight size={16}/></button></div>}
  </div></main></div>;
}
