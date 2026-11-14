import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import library from '../src-tauri/src/challenge_library.json';
import { ProjectsPage } from './ProjectsPage';
import type { ChallengeData } from './services/challenges';
import type { Project, ProjectsData } from './services/projects';
import type { WorkspaceData } from './services/workspace';

const challenge = library[0]!;
const project: Project = { id:'project-1',title:'Site drawing',description:'Synthetic drawing',discipline:'Civil drafting',category:'Learning challenge',projectType:'Educational',software:['AutoCAD'],startDate:null,targetDate:null,status:'Planning',priority:'normal',createdAtMs:1,updatedAtMs:1,completedAtMs:null,portfolioCandidate:false,portfolioSummary:'',objectives:'',contributions:'',skills:'',decisions:'',lessons:'' };
const data: ProjectsData = { projects:[project],milestones:[],files:[],journal:[] };
const challenges = { challenges:[challenge],versions:[challenge],projects:[{challengeId:challenge.id,projectId:project.id,createdFromChallenge:true}],progress:[{challengeId:challenge.id,checks:[0],status:'In Progress'}] } as ChallengeData;
const noop = async () => true;

describe('linked project workspace', () => {
  afterEach(cleanup);
  it('opens a requested project with challenge progress and a route back', () => {
    const openChallenge=vi.fn();
    render(<ProjectsPage data={data} workspace={{tasks:[]} as unknown as WorkspaceData} challenges={challenges} initialProjectId={project.id} openChallenge={openChallenge} saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(screen.getByRole('heading',{name:'Site drawing'})).toBeInTheDocument();
    expect(screen.getByText(`In Progress | 1/${challenge.checklist.length} criteria`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review challenge'}));
    expect(openChallenge).toHaveBeenCalledWith(challenge.id);
  });
  it('opens Portfolio Studio for the requested project without selecting export content', async () => {
    render(<ProjectsPage data={data} workspace={{tasks:[]} as unknown as WorkspaceData} challenges={challenges} initialProjectId={project.id} initialSection="Portfolio" saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(await screen.findByRole('heading',{name:'Portfolio Studio'})).toBeInTheDocument();
    expect(screen.getByText(/0 of 7 parts started/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox',{name:'Portfolio candidate'})).not.toBeChecked();
  });
  it('focuses the linked task and returns to Calendar without changing progress',()=>{
    const backToCalendar=vi.fn();
    const linked={id:'task-1',title:'Draft plan',projectId:project.id,dueDate:'2026-11-16',dueTime:null,completedAtMs:null};
    const workspace={tasks:[linked]} as unknown as WorkspaceData;
    render(<ProjectsPage data={data} workspace={workspace} initialProjectId={project.id} initialSection="Tasks" initialItemId={linked.id} backToCalendar={backToCalendar} saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(document.activeElement?.id).toBe('project-tasks-task-1');
    expect(screen.getByText('Draft plan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Back to Calendar'}));
    expect(backToCalendar).toHaveBeenCalledOnce();
    expect(linked.completedAtMs).toBeNull();
  });
  it('opens an archived milestone, and handles a removed project or item',()=>{
    const archived={...project,status:'Archived' as const};
    const m={id:'mile-1',projectId:project.id,title:'Drawing review',description:'',targetDate:'2026-11-16',completedAtMs:null,createdAtMs:1,updatedAtMs:1};
    const view=render(<ProjectsPage data={{...data,projects:[archived],milestones:[m]}} workspace={{tasks:[]} as unknown as WorkspaceData} initialProjectId={project.id} initialSection="Milestones" initialItemId={m.id} saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(document.activeElement?.id).toBe('project-milestones-mile-1');
    expect(screen.getByText('Drawing review')).toBeInTheDocument();
    view.unmount();
    const backToCalendar=vi.fn();
    const missing=render(<ProjectsPage data={data} workspace={{tasks:[]} as unknown as WorkspaceData} initialProjectId="deleted" initialSection="Tasks" initialItemId="gone" backToCalendar={backToCalendar} saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(screen.getByRole('status')).toHaveTextContent(/project is no longer available/);
    fireEvent.click(screen.getByRole('button',{name:'Back to Calendar'}));
    expect(backToCalendar).toHaveBeenCalledOnce();
    missing.unmount();
    render(<ProjectsPage data={data} workspace={{tasks:[]} as unknown as WorkspaceData} initialProjectId={project.id} initialSection="Milestones" initialItemId="gone" saveProject={noop} saveMilestone={noop} completeMilestone={async()=>{}} deleteItem={async()=>{}} associateTask={async()=>{}} saveTask={noop} completeTask={async()=>{}} saveFile={noop} openFile={async()=>{}} saveJournal={noop}/>);
    expect(screen.getByRole('status')).toHaveTextContent(/selected milestone is no longer available/);
  });
});
