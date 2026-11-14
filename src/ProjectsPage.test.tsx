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
});
