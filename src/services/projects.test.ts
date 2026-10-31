import { beforeEach, describe, expect, it } from 'vitest';
import { associateTask, deleteProjectItem, loadProjects, projectProgress, saveJournalEntry, saveMilestone, saveProject, selectProjects, setMilestoneCompleted, type Project } from './projects';
import { previewWorkspace, saveTask, setTaskCompleted } from './workspace';

const project = (): Project => ({ id:'project-1', title:'Drainage design', description:'', discipline:'Water Resources', category:'Coursework', projectType:'Academic exercise', software:['Civil 3D'], startDate:null, targetDate:'2026-12-01', status:'Planning', priority:null, createdAtMs:0, updatedAtMs:0, completedAtMs:null, portfolioCandidate:false, portfolioSummary:'', objectives:'', contributions:'', skills:'', decisions:'', lessons:'' });
describe('project workspace preview behavior', () => {
  beforeEach(async () => {
    const p=await loadProjects(); for(const m of p.milestones)await deleteProjectItem('milestone',m.id);
    // Preview data stays in memory for browser tests; use unique ids below.
    previewWorkspace().tasks=[]; previewWorkspace().progression.xp=0; previewWorkspace().progression.history=[];
  });
  it('stores project details and status transitions without inventing progress', async () => {
    const p={...project(),id:crypto.randomUUID()}; await saveProject(p);
    expect((await loadProjects()).projects.find(x=>x.id===p.id)?.software).toEqual(['Civil 3D']);
    expect(projectProgress(p.id,[],[])).toBe(0);
    await saveProject({...p,status:'Completed',portfolioCandidate:true,portfolioSummary:'Private summary'});
    const done=(await loadProjects()).projects.find(x=>x.id===p.id)!;
    expect(done.completedAtMs).toBeTruthy(); expect(done.portfolioSummary).toBe('Private summary');
    await saveProject({...done,status:'Archived'});
    expect((await loadProjects()).projects.find(x=>x.id===p.id)?.status).toBe('Archived');
    expect(selectProjects(await loadProjects(),[], 'drainage','Water Resources','Archived','name').some(x=>x.id===p.id)).toBe(true);
    expect(selectProjects(await loadProjects(),[], 'drainage','Transportation','all','name').some(x=>x.id===p.id)).toBe(false);
  });
  it('links an existing task and shares the single completion reward path', async () => {
    const p={...project(),id:crypto.randomUUID()}; await saveProject(p);
    const id=crypto.randomUUID(); await saveTask({id,title:'Review calculations',description:'',category:'',priority:'normal',dueDate:null,dueTime:null,subtasks:[],reminderOffsetMinutes:null});
    await associateTask(id,p.id); expect(previewWorkspace().tasks[0]?.projectId).toBe(p.id);
    await setTaskCompleted(id,true); await setTaskCompleted(id,true);
    expect(previewWorkspace().progression.xp).toBe(25);
    expect(projectProgress(p.id,previewWorkspace().tasks,[])).toBe(100);
    await associateTask(id,null); expect(previewWorkspace().tasks[0]?.projectId).toBeNull();
  });
  it('persists milestone and journal fields', async () => {
    const p={...project(),id:crypto.randomUUID()}; await saveProject(p);
    const m={id:crypto.randomUUID(),projectId:p.id,title:'Calculations',description:'Runoff',targetDate:'2026-11-15',completedAtMs:null,createdAtMs:0,updatedAtMs:0};
    await saveMilestone(m); await setMilestoneCompleted(m.id,true);
    expect(projectProgress(p.id,[],(await loadProjects()).milestones)).toBe(100);
    await setMilestoneCompleted(m.id,false); expect(projectProgress(p.id,[],(await loadProjects()).milestones)).toBe(0);
    const j={id:crypto.randomUUID(),projectId:p.id,title:'Iteration one',entryDate:'2026-11-01',description:'Preserve exact wording',workCompleted:'Flow analysis',problems:'High velocity',solutions:'Increase section',skills:'Hydrology',fileIds:[],createdAtMs:0,updatedAtMs:0};
    await saveJournalEntry(j); expect((await loadProjects()).journal.find(x=>x.id===j.id)?.solutions).toBe('Increase section');
  });
});
