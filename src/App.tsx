import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Menu, Moon, Sparkles, X } from 'lucide-react';
import type { AppSnapshot, Engagement } from './domain/types';
import { transitionPip } from './domain/pip';
import type { PipEvent } from './domain/pip';
import { loadSnapshot, saveSnapshot } from './services/storage';
import { deleteTask, equipCosmetic, focusAction, loadWorkspace, saveTask, setFocusDefaults, setTaskCompleted, type TaskInput, type WorkspaceData } from './services/workspace';
import { AchievementsPage, CustomizationPage, FocusPage, TasksPage, type TaskScope } from './ProductivityPages';
import { MyDay } from './MyDay';
import { PipTabs } from './components/PipTabs';
import { isGroup, locate, mainNav, pageLabel, utilityNav, type NavItem } from './navigation';
import { CalendarPage } from './CalendarPage';
import { NotificationsPage } from './NotificationsPage';
import { claimReminder, deleteEvent, inQuietHours, reminderCandidates, saveEvent, saveReminderPreferences } from './services/calendar';
import { PipIllustration } from './components/PipIllustration';
import { Button } from './components/ui/button';
import { ProjectsPage } from './ProjectsPage';
import { ChallengesPage } from './ChallengesPage';
import { addChallengeEvidence, assignWeek, challengeAction, createChallengeProject, linkChallengeProject, loadChallenges, removeChallengeEvidence, saveChallengeSettings, weekStart, type ChallengeData } from './services/challenges';
import { SchoolPage, type SchoolFocus } from './SchoolPage';
import { contextLabel, courseworkItems, itemFor } from './domain/academic';
import { loadAcademic, saveCourse, saveCoursework, saveSemester, setActiveSemester, setCourseArchived, setSemesterArchived, type AcademicData } from './services/academic';
import { associateTask, deleteProjectItem, loadProjects, openProjectFile, saveJournalEntry, saveMilestone, saveProject, saveProjectFile, setMilestoneCompleted, type ProjectsData } from './services/projects';

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
  return <section className="pip-card" aria-label="Pip companion"><div className="card-heading"><h2>Say hello to Pip</h2><button className="icon-button" aria-label="Hide Pip" title="Hide Pip" onClick={onHide}><X size={17}/></button></div><button className="pip-interaction" onClick={() => onPip(sleeping ? 'WAKE' : 'PET')} aria-label={sleeping ? 'Wake Pip' : 'Pet Pip'}><PipIllustration state={companion.state} reducedMotion={preferences.reducedMotion} styleId={progress.styleId} scarf={progress.scarf} headphones={progress.headphones} aura={progress.earned.includes('level_five')}/></button><div className="pip-caption">{pipCaption(companion.state)}</div><div className="pip-actions"><button onClick={() => onPip(sleeping ? 'WAKE' : 'REST')} className="soft-button"><Moon size={15}/>{sleeping ? 'Wake Pip' : 'Let Pip rest'}</button><button onClick={() => onPip('EXPLORE')} className="soft-button" disabled={sleeping || preferences.focusMode}><Sparkles size={15}/>Explore</button></div><div className="pip-level">Level {progress.level} · {progress.xp} XP</div></section>;
}
function pipCaption(state: AppSnapshot['companion']['state']): string {
  return state === 'sleeping' ? 'Pip is resting. Wake them when you like.' : state === 'focused' ? 'Pip is keeping you company quietly.' : state === 'affectionate' ? 'Pip likes having you around.' : state === 'curious' ? 'Pip is ready to explore with you.' : 'Pip is here when you need a little company.';
}
/** A small, always-in-the-same-place companion in the sidebar footer. It never carries notifications or XP prompts. */
function PipDock({ snapshot, data, collapsed, onPip, open }: { snapshot: AppSnapshot; data: WorkspaceData; collapsed: boolean; onPip: (event: PipEvent) => void; open: () => void }) {
  const { companion, preferences } = snapshot;
  if (!preferences.pipVisible || !preferences.dashboardPipEnabled) return null;
  const sleeping = companion.state === 'sleeping';
  const progress = data.progression;
  return <div className="pip-dock"><button className="pip-dock-art" onClick={() => onPip(sleeping ? 'WAKE' : 'PET')} aria-label={sleeping ? 'Wake Pip' : 'Pet Pip'} title={pipCaption(companion.state)}><PipIllustration state={companion.state} reducedMotion={preferences.reducedMotion} styleId={progress.styleId} scarf={progress.scarf} headphones={progress.headphones} aura={progress.earned.includes('level_five')}/></button>{!collapsed && <button className="pip-dock-text" onClick={open} aria-label="Open Pip page">Pip<small>Level {progress.level} · {sleeping ? 'resting' : 'here'}</small></button>}</div>;
}
function Settings({ snapshot, update }: { snapshot: AppSnapshot; update: (next: AppSnapshot) => void }) {
  const p = snapshot.preferences;
  const set = (patch: Partial<typeof p>) => update({ ...snapshot, preferences: { ...p, ...patch }, companion: patch.focusMode === undefined ? snapshot.companion : { ...snapshot.companion, state: patch.focusMode ? 'focused' : 'relaxed' } });
  return <div className="page-panel"><h1>Settings</h1><p>Choose how CivilDesk feels and how Pip shares your space.</p><div className="setting-group"><h2>Profile</h2><label htmlFor="settings-name">Display name</label><input id="settings-name" value={p.displayName} maxLength={60} onChange={e => set({ displayName: e.target.value })}/></div><div className="setting-group"><h2>Companion</h2><label className="setting-row"><span><strong>Show Pip</strong><small>Display Pip in the sidebar and on the Pip page</small></span><input type="checkbox" checked={p.pipVisible} onChange={e => set({ pipVisible: e.target.checked })}/></label><label className="setting-row"><span><strong>Sidebar companion</strong><small>Keep Pip in the corner of the sidebar</small></span><input type="checkbox" checked={p.dashboardPipEnabled} onChange={e => set({ dashboardPipEnabled: e.target.checked })}/></label><label htmlFor="engagement-setting">Engagement level</label><select id="engagement-setting" value={p.engagement} onChange={e => set({ engagement: e.target.value as Engagement })}><option value="quiet">Quiet</option><option value="balanced">Balanced</option><option value="playful">Playful</option></select><label className="setting-row"><span><strong>Focus mode</strong><small>Suppress decorative reactions</small></span><input type="checkbox" checked={p.focusMode} onChange={e => set({ focusMode: e.target.checked })}/></label><label className="setting-row"><span><strong>Reduced motion</strong><small>Keep Pip still and minimize interface transitions</small></span><input type="checkbox" checked={p.reducedMotion} onChange={e => set({ reducedMotion: e.target.checked })}/></label></div></div>;
}
export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [projects, setProjects] = useState<ProjectsData | null>(null);
  const [challenges, setChallenges] = useState<ChallengeData | null>(null);
  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [schoolFocus, setSchoolFocus] = useState<SchoolFocus | null>(null);
  const [page, setPage] = useState('Dashboard');
  const [startNewTask, setStartNewTask] = useState(false);
  const [focusTask, setFocusTask] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  useEffect(() => { const onResize = () => setNarrow(window.innerWidth <= 760); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);
  const go = (next: string) => { setStartNewTask(false); setSchoolFocus(null); setPage(next); };
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reminderAlert, setReminderAlert] = useState('');
  const attemptedWeek = useRef('');
  useEffect(() => { Promise.all([loadSnapshot(), loadWorkspace(), loadProjects(), loadChallenges(), loadAcademic()]).then(([s, w, p, c, a]) => { setSnapshot(s); setWorkspace(w); setProjects(p); setChallenges(c); setAcademic(a); }).catch(e => setError(String(e))); }, []);
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
    try { await operation(); const [w,p,a] = await Promise.all([loadWorkspace(),loadProjects(),loadAcademic()]); setWorkspace(w); setProjects(p); setAcademic(a); setError(''); return true; }
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
  /** Runs an academic save and returns its error text so the open dialog can show it. */
  async function runAcademic(operation: () => Promise<void>): Promise<string | null> {
    setSaving(true);
    try { await operation(); const [w, a] = await Promise.all([loadWorkspace(), loadAcademic()]); setWorkspace(w); setAcademic(a); setError(''); return null; }
    catch (e) { return e instanceof Error ? e.message : String(e); }
    finally { setSaving(false); }
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
  if (!snapshot || !workspace || !projects || !challenges || !academic) return <div className="loading">Opening CivilDesk…</div>;
  if (!snapshot.preferences.onboardingComplete) return <>{error && <div role="alert" className="error-banner">{error}</div>}<Onboarding onDone={(name, visible, engagement) => void update({ ...snapshot, preferences: { ...snapshot.preferences, displayName: name, pipVisible: visible, engagement, onboardingComplete: true } })}/></>;
  const collapsed = snapshot.preferences.sidebarCollapsed || narrow;
  const { activeId, group: activeGroup } = locate(page);
  const scopeOf: Record<string, TaskScope> = { School: 'school', Personal: 'personal', Tasks: 'all', 'Engineering Tasks': 'engineering' };
  const pageForScope = (scope: TaskScope) => scope === 'school' ? 'School' : scope === 'personal' ? 'Personal' : scope === 'engineering' ? 'Engineering Tasks' : 'Tasks';
  const navButton = (item: NavItem, nested = false) => <button title={item.label} key={item.id} className={'nav-item ' + (nested ? 'nested ' : '') + (activeId === item.id ? 'active' : '')} aria-current={activeId === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon size={17} strokeWidth={1.8}/><span>{item.label}</span></button>;
  const courseworkAll = courseworkItems(workspace.tasks, academic);
  const openCoursework = (taskId: string) => { const item = itemFor(courseworkAll, taskId); if (!item) return; setStartNewTask(false); setSchoolFocus({ courseId: item.course.id, taskId }); setPage('School'); };
  const academicLabel = (taskId: string) => contextLabel(itemFor(courseworkAll, taskId));
  const hidePip = () => void update({ ...snapshot, preferences: { ...snapshot.preferences, pipVisible: false } });
  const crumbParent = activeGroup ? activeGroup.label : activeId !== page ? pageLabel(activeId) : '';
  return <div className="shell"><aside className={'sidebar ' + (collapsed ? 'collapsed ' : '') + (narrow ? 'narrow' : '')}><div className="sidebar-top"><div className="brand"><span className="brand-mark small">C</span><span className="brand-name">CivilDesk</span></div><button className="icon-button collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, sidebarCollapsed: !collapsed } })}>{collapsed ? <Menu size={18}/> : <ChevronLeft size={18}/>}</button></div>
    <nav aria-label="Main navigation">{mainNav.map(entry => {
      if (!isGroup(entry)) return navButton(entry);
      const isOpen = collapsed || (expanded[entry.id] ?? activeGroup?.id === entry.id);
      return <div className="nav-section" key={entry.id}>{!collapsed && <button className={'nav-item nav-group-toggle ' + (activeGroup?.id === entry.id && !isOpen ? 'has-active' : '')} aria-expanded={isOpen} aria-controls={'nav-' + entry.id} onClick={() => setExpanded(x => ({ ...x, [entry.id]: !isOpen }))}><entry.icon size={17} strokeWidth={1.8}/><span>{entry.label}</span><ChevronRight className="chevron" size={14}/></button>}{isOpen && <div id={'nav-' + entry.id} role="group" aria-label={entry.label}>{entry.items.map(item => navButton(item, !collapsed))}</div>}</div>;
    })}</nav>
    <div className="sidebar-bottom"><PipDock snapshot={snapshot} data={workspace} collapsed={collapsed} onPip={pip} open={() => go('Pip')}/><div className="utility-nav">{utilityNav.map(item => navButton(item))}</div><div className="account"><span className="avatar">{snapshot.preferences.displayName.charAt(0).toUpperCase() || 'C'}</span><span className="account-name">{snapshot.preferences.displayName}<small>Stored on this computer</small></span></div></div></aside>
    <main className="main"><header className="topbar"><nav className="breadcrumb" aria-label="Breadcrumb">{crumbParent && (activeGroup ? <span>{crumbParent}</span> : <button className="crumb-link" onClick={() => go(activeId)}>{crumbParent}</button>)}{crumbParent && <ChevronRight size={14}/>}<strong aria-current="page">{pageLabel(page)}</strong></nav><div className="top-actions">{saving && <span className="save-status" role="status">Saving…</span>}</div></header>{error && <div role="alert" className="error-banner">{error}</div>}{reminderAlert && <div className="reminder-banner" role="status"><span>{reminderAlert}</span><button aria-label="Dismiss reminder" onClick={() => setReminderAlert('')}>Dismiss</button></div>}<div className="content">
    {page === 'Calendar' ? <CalendarPage data={workspace} projects={projects} challenges={challenges} academic={academic} openCoursework={openCoursework} save={async event => mutate(() => saveEvent(event))} remove={async id => { await mutate(() => deleteEvent(id)); }}/>
      : page === 'Notifications' ? <NotificationsPage data={workspace} save={async prefs => { await mutate(() => saveReminderPreferences(prefs)); }}/>
      : page === 'Weekly Challenges' || page === 'Skills' ? <ChallengesPage key={page} initialTab={page === 'Skills' ? 'skills' : 'board'} data={challenges} projects={projects} refresh={async()=>{const [c,p]=await Promise.all([loadChallenges(),loadProjects()]);setChallenges(c);setProjects(p)}} saveSettings={saveChallengeSettings} assign={assignWeek} act={async(id,action,options)=>{await challengeAction(id,action,options);if(action==='complete'&&challenges.progress.find(p=>p.challengeId===id)?.status!=='Completed')pip('ENGINEERING_ACCOMPLISHMENT')}} evidence={addChallengeEvidence} removeEvidence={removeChallengeEvidence} link={linkChallengeProject} createProject={async id=>{const existing=challenges.projects.some(p=>p.challengeId===id&&p.createdFromChallenge);await createChallengeProject(id);if(!existing)pip('ENGINEERING_ACCOMPLISHMENT')}}/>
      : page === 'School' ? <SchoolPage key={schoolFocus ? schoolFocus.taskId : 'school'} data={workspace} academic={academic} focus={schoolFocus} startWithNew={startNewTask} onScope={scope => go(pageForScope(scope))} run={runAcademic} ops={{ saveSemester, setActive: setActiveSemester, archiveSemester: setSemesterArchived, saveCourse, archiveCourse: setCourseArchived, saveCoursework }} save={async (task: TaskInput) => mutate(() => saveTask(task))} remove={async id => { await mutate(() => deleteTask(id)); }} complete={completeTask} startFocus={id => { setFocusTask(id); go('Focus Sessions'); }}/>
      : page in scopeOf ? <TasksPage data={workspace} scope={scopeOf[page]!} startWithNew={startNewTask} onScope={scope => go(pageForScope(scope))} save={async (task: TaskInput) => mutate(() => saveTask(task))} remove={async id => { await mutate(() => deleteTask(id)); }} complete={completeTask}/>
      : page === 'Projects' || page === 'Engineering Journal' ? <ProjectsPage data={projects} workspace={workspace} saveProject={p=>mutate(()=>saveProject(p))} saveMilestone={m=>mutate(()=>saveMilestone(m))} completeMilestone={async(id,value)=>{await mutate(()=>setMilestoneCompleted(id,value))}} deleteItem={async(kind,id)=>{await mutate(()=>deleteProjectItem(kind,id))}} associateTask={async(taskId,projectId)=>{await mutate(()=>associateTask(taskId,projectId))}} saveTask={t=>mutate(()=>saveTask(t))} completeTask={completeTask} saveFile={f=>mutate(()=>saveProjectFile(f))} openFile={async id=>{try{await openProjectFile(id)}catch(e){setError(String(e))}}} saveJournal={j=>mutate(()=>saveJournalEntry(j))}/>
      : page === 'Focus Sessions' ? <FocusPage data={workspace} initialTaskId={focusTask} taskLabel={academicLabel} defaults={async (d, b) => mutate(() => setFocusDefaults(d, b))} action={actFocus}/>
      : page === 'Settings' ? <Settings snapshot={snapshot} update={next => void update(next)}/>
      : page === 'Pip' ? <div className="page-panel"><PipTabs current="Pip" goTo={go}/><h1>Pip</h1><p>A gentle presence for your workday. Pip follows your pace.</p>{snapshot.preferences.pipVisible ? <div className="pip-page"><PipCard snapshot={snapshot} data={workspace} onPip={pip} onHide={hidePip}/></div> : <div className="empty-state"><h2>Pip is taking a break</h2><p>Bring Pip back whenever you like. Your level and rewards are kept.</p><button className="primary-button" onClick={() => void update({ ...snapshot, preferences: { ...snapshot.preferences, pipVisible: true } })}>Show Pip</button></div>}</div>
      : page === 'Customization' ? <CustomizationPage data={workspace} goTo={go} state={snapshot.companion.state} reducedMotion={snapshot.preferences.reducedMotion} equip={async (id, equipped) => { await mutate(() => equipCosmetic(id, equipped)); }}/>
      : page === 'Achievements' ? <AchievementsPage data={workspace} goTo={go}/>
      : page === 'About and Updates' ? <div className="page-panel"><h1>About CivilDesk</h1><p>A local-first workspace for school, personal planning and engineering work. Your data stays on this computer.</p><div className="roadmap"><h2>What works today</h2><p>Tasks, a unified calendar, focus sessions, engineering projects, weekly challenges and skills, reminders, and Pip with achievements and wardrobe.</p><h2>What comes next</h2><p>Course management, notes, portfolio tools and new Pip cosmetics arrive in later milestones. Nothing in the sidebar is a placeholder.</p></div></div>
      : <MyDay name={snapshot.preferences.displayName} academic={academic} openCoursework={openCoursework} data={workspace} projects={projects} challenges={challenges} complete={completeTask} goTo={go} newTask={() => { setStartNewTask(true); setPage('Tasks'); }} startFocus={id => { setFocusTask(id ?? ''); go('Focus Sessions'); }}/>}
  </div></main></div>;
}
