import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import library from '../src-tauri/src/challenge_library.json';
import { CalendarPage, type CalendarPosition } from './CalendarPage';
import type { Project, ProjectsData } from './services/projects';
import type { Task, WorkspaceData } from './services/workspace';
import type { ChallengeData } from './services/challenges';
import type { AcademicData } from './services/academic';
import type { StudyData } from './services/study';
import type { PersonalData } from './services/personal';

const date='2026-11-16';
const position:CalendarPosition={view:'month',cursor:date,selected:date};
const project=(id:string,status:Project['status']='Planning'):Project=>({id,title:'Project '+id,description:'',discipline:'Civil drafting',category:'',projectType:'Educational',software:[],startDate:null,targetDate:null,status,priority:null,createdAtMs:1,updatedAtMs:1,completedAtMs:null,portfolioCandidate:false,portfolioSummary:'',objectives:'',contributions:'',skills:'',decisions:'',lessons:''});
const task=(id:string,projectId:string|null):Task=>({id,title:'Task '+id,description:'',category:'Engineering',priority:'normal',dueDate:date,dueTime:null,subtasks:[],reminderOffsetMinutes:null,createdAtMs:1,updatedAtMs:1,completedAtMs:null,firstCompletedAtMs:null,projectId});
const workspace=(tasks:Task[],events:WorkspaceData['events']=[]):WorkspaceData=>({tasks,events,sessions:[],reminderPreferences:{enabled:false,quietStart:'22:00',quietEnd:'08:00'},focusDurationMinutes:25,breakDurationMinutes:5,progression:{xp:0,level:1,earned:[],unlocked:[],styleId:'classic',scarf:false,headphones:false,history:[]}});
const milestone=(id:string,projectId:string)=>({id,projectId,title:'Milestone '+id,description:'',targetDate:date,completedAtMs:null,createdAtMs:1,updatedAtMs:1});
const empty={challenges:{progress:[]} as unknown as ChallengeData,academic:{courses:[],work:[]} as unknown as AcademicData,study:{blocks:[],sessions:[]} as unknown as StudyData,personal:{routines:[]} as unknown as PersonalData};
const challengeData=(status:'In Progress'|'Completed'|'Skipped'='In Progress',id=library[0]!.id):ChallengeData=>({challenges:structuredClone(library),versions:structuredClone(library),settings:{automatic:false,tracks:[],difficulties:[],weeklyCount:1},assignments:[],progress:[{challengeId:id,contentVersion:1,mode:'guided',status,notes:'',deadlineDate:date,startedAtMs:1,completedAtMs:status==='Completed'?2:null,checks:[]}],evidence:[],pathways:[],projects:[]});
const noop=async()=>true;
function mount(data:WorkspaceData,projects:ProjectsData,options:Partial<Parameters<typeof CalendarPage>[0]>={}){
  const openProject=vi.fn();
  const view=render(<CalendarPage data={data} projects={projects} {...empty} position={position} openProject={openProject} openPersonal={()=>{}} openStudyBlock={()=>{}} openCoursework={()=>{}} save={noop} remove={async()=>{}} {...options}/>);
  return {...view,openProject};
}

describe('calendar project navigation',()=>{
  afterEach(cleanup);
  it.each(['Month','Week','Day'])('opens the correct task and milestone project from %s view',view=>{
    const projects={projects:[project('one'),project('two')],milestones:[milestone('m2','two')],files:[],journal:[]};
    const before=structuredClone(projects);
    const tasks=[task('t1','one')];
    const {openProject}=mount(workspace(tasks),projects);
    if(view!=='Month')fireEvent.click(screen.getByRole('button',{name:view}));
    fireEvent.click(screen.getByRole('button',{name:'Open project for Task t1'}));
    fireEvent.click(screen.getByRole('button',{name:'Open project for Milestone m2'}));
    expect(openProject).toHaveBeenNthCalledWith(1,'one',{kind:'task',itemId:'t1'});
    expect(openProject).toHaveBeenNthCalledWith(2,'two',{kind:'milestone',itemId:'m2'});
    expect(projects).toEqual(before);
    expect(tasks[0]?.completedAtMs).toBeNull();
  });
  it('shows no project action for an unrelated event or task',()=>{
    const event={id:'event-1',title:'Site visit',description:'',startDate:date,startTime:null,endDate:date,endTime:null,allDay:true,timeZone:'America/New_York',startAtMs:null,endAtMs:null,reminderOffsetMinutes:null,createdAtMs:1,updatedAtMs:1};
    mount(workspace([task('personal',null)],[event]),{projects:[],milestones:[],files:[],journal:[]});
    expect(screen.queryByRole('button',{name:/Open project/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Site visit'}));
    expect(screen.getByRole('heading',{name:'Site visit'})).toBeInTheDocument();
  });
  it('handles a deleted project safely and still opens an archived project',()=>{
    const {openProject}=mount(workspace([task('orphan','deleted'),task('archived','archive')]),{projects:[project('archive','Archived')],milestones:[milestone('missing','deleted')],files:[],journal:[]});
    expect(screen.getAllByText(/Project unavailable/)).toHaveLength(2);
    expect(screen.queryByRole('button',{name:'Open project for Task orphan'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Open project for Milestone missing'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Open project for Task archived'}));
    expect(openProject).toHaveBeenCalledWith('archive',{kind:'task',itemId:'archived'});
  });
  it('restores the selected day and keyboard focus after returning from a project',()=>{
    const projects={projects:[project('one')],milestones:[],files:[],journal:[]};
    const first=mount(workspace([task('t1','one')]),projects);
    fireEvent.click(screen.getByRole('button',{name:'Week'}));
    const chosen=screen.getByRole('button',{name:/Tue Nov 17 2026/});
    fireEvent.click(chosen);
    const saved:CalendarPosition={view:'week',cursor:'2026-11-17',selected:'2026-11-17'};
    first.unmount();
    mount(workspace([task('t1','one')]),projects,{position:saved,returnFocus:{kind:'task',itemId:'t1'}});
    expect(screen.getByRole('button',{name:'Week'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('heading',{name:/Tuesday, November 17/})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Tue Nov 17 2026/})).toHaveFocus();
  });
  it.each(['Month','Week','Day'])('opens a saved challenge deadline by ID from %s view',view=>{
    const challenges=challengeData(), c=challenges.challenges[0]!, openChallenge=vi.fn();
    challenges.assignments=[{id:'weekly',weekStart:date,challengeId:c.id,contentVersion:1,source:'manual',status:'In Progress'}];
    const data=workspace([]), before=structuredClone({challenges,data});
    mount(data,{projects:[],milestones:[],files:[],journal:[]},{challenges,openChallenge});
    if(view!=='Month')fireEvent.click(screen.getByRole('button',{name:view}));
    const day=screen.getByRole('button',{name:/Mon Nov 16 2026/});
    expect(within(day).getByText('Challenge - '+c.title)).toBeInTheDocument();
    expect(day).toHaveAccessibleName(/1 challenge deadline/);
    const detail=document.querySelector('.calendar-detail');
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByRole('button',{name:'Open challenge '+c.title})).toBeInTheDocument();
    expect(within(detail as HTMLElement).queryByText('Nothing scheduled for this day.')).toBeNull();
    expect(document.querySelectorAll('.calendar-detail-row')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Open challenge '+c.title}));
    expect(openChallenge).toHaveBeenCalledExactlyOnceWith(c.id);
    expect(data.events).toHaveLength(0);
    expect({challenges,data}).toEqual(before);
  });
  it.each(['Month','Week','Day'])('shows the empty state for a genuinely empty %s day',view=>{
    mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]});
    if(view!=='Month')fireEvent.click(screen.getByRole('button',{name:view}));
    const detail=document.querySelector('.calendar-detail') as HTMLElement;
    expect(within(detail).getByText('Nothing scheduled for this day.')).toBeInTheDocument();
    expect(within(detail).queryByRole('button',{name:/Open (challenge|project)/})).toBeNull();
  });
  it('keeps a challenge and project milestone in one selected-day detail without duplicate records',()=>{
    const challenges=challengeData(), projects={projects:[project('p1')],milestones:[milestone('m1','p1')],files:[],journal:[]};
    const data=workspace([]), before=structuredClone({challenges,projects,data});
    mount(data,projects,{challenges,openChallenge:vi.fn()});
    const detail=document.querySelector('.calendar-detail') as HTMLElement;
    expect(within(detail).getByRole('button',{name:'Open challenge '+challenges.challenges[0]!.title})).toBeInTheDocument();
    expect(within(detail).getByRole('button',{name:'Open project for Milestone m1'})).toBeInTheDocument();
    expect(within(detail).queryByText('Nothing scheduled for this day.')).toBeNull();
    expect(document.querySelectorAll('.calendar-detail-row')).toHaveLength(2);
    expect({challenges,projects,data}).toEqual(before);
  });
  it('hides completed and skipped commitments without erasing their saved dates',()=>{
    for(const status of ['Completed','Skipped'] as const){
      const value=challengeData(status), before=structuredClone(value);
      const view=mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge:vi.fn()});
      expect(screen.queryByRole('button',{name:/Open challenge/})).toBeNull();
      expect(screen.queryByText(/Challenge -/)).toBeNull();
      expect(screen.getByText('Nothing scheduled for this day.')).toBeInTheDocument();
      expect(value).toEqual(before);
      view.unmount();
    }
  });
  it('shows a missing challenge as unavailable without an unsafe action',()=>{
    const value=challengeData('In Progress','removed-id');
    mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge:vi.fn()});
    expect(screen.getByText('Challenge unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Open challenge/})).toBeNull();
  });
  it('uses the saved challenge version and fails closed when that version is unavailable',()=>{
    const value=challengeData(), original=value.versions[0]!;
    value.challenges[0]={...original,title:'Newer unsaved title',version:original.version+1};
    const first=mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge:vi.fn()});
    expect(screen.getByRole('button',{name:'Open challenge '+original.title})).toBeInTheDocument();
    expect(screen.queryByText('Newer unsaved title')).toBeNull();
    first.unmount();
    value.versions=[];
    mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge:vi.fn()});
    expect(screen.getByText('Challenge unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Open challenge/})).toBeNull();
  });
  it('keeps multiple saved deadlines in one day marker and separate exact-ID actions',()=>{
    const value=challengeData(), second=library[1]!;
    value.progress.push({...value.progress[0]!,challengeId:second.id});
    const openChallenge=vi.fn(), data=workspace([]);
    mount(data,{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge});
    const day=screen.getByRole('button',{name:/Mon Nov 16 2026/});
    expect(within(day).getByText(/Challenge - .* \+1/)).toBeInTheDocument();
    expect(day).toHaveAccessibleName(/2 challenge deadlines/);
    expect(document.querySelectorAll('.calendar-detail .calendar-detail-row')).toHaveLength(2);
    expect(screen.queryByText('Nothing scheduled for this day.')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Open challenge '+second.title}));
    expect(openChallenge).toHaveBeenCalledExactlyOnceWith(second.id);
    expect(data.events).toHaveLength(0);
  });
  it('restores focus to the exact deadline action on return',()=>{
    const value=challengeData(), c=value.challenges[0]!, onReturnFocused=vi.fn();
    mount(workspace([]),{projects:[],milestones:[],files:[],journal:[]},{challenges:value,openChallenge:vi.fn(),returnFocus:{kind:'challenge',itemId:c.id},onReturnFocused});
    expect(screen.getByRole('button',{name:'Open challenge '+c.title})).toHaveFocus();
    expect(onReturnFocused).toHaveBeenCalledOnce();
  });
});
