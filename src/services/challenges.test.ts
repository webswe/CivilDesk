import { describe, expect, it } from 'vitest';
import { addChallengeEvidence, available, createChallengeProject, loadChallenges, skillProgress, weekStart, weeklyPreview, type ChallengeData } from './challenges';
import { loadProjects } from './projects';
import library from '../../src-tauri/src/challenge_library.json';

const data=():ChallengeData=>({challenges:structuredClone(library),versions:structuredClone(library),settings:{automatic:false,tracks:['AutoCAD'],difficulties:['Beginner'],weeklyCount:1},assignments:[],progress:[],evidence:[],pathways:[],projects:[]});
describe('engineering challenges',()=>{
  it('loads nine complete, unique offline challenge definitions',()=>{
    expect(library).toHaveLength(9);
    expect(new Set(library.map(c=>c.id)).size).toBe(9);
    for(const c of library){expect(c.objectives.length).toBeGreaterThan(0);expect(c.guided.length).toBeGreaterThan(2);expect(c.deliverables.length).toBeGreaterThan(0);expect(c.checklist.length).toBeGreaterThan(0);}
  });
  it('uses a local Monday across a daylight-saving transition and year boundary',()=>{
    expect(weekStart(new Date(2026,2,8,23,30))).toBe('2026-03-02');
    expect(weekStart(new Date(2026,2,9,0,30))).toBe('2026-03-09');
    expect(weekStart(new Date(2027,0,1))).toBe('2026-12-28');
  });
  it('honors prerequisites but allows independent work',()=>{
    const d=data();expect(available(d.challenges.find(c=>c.id==='c3d-alignment')!,d)).toBe(false);
    expect(available(d.challenges.find(c=>c.id==='revit-bim')!,d)).toBe(true);
    d.progress.push({challengeId:'c3d-survey',contentVersion:1,mode:'guided',status:'Completed',notes:'',deadlineDate:null,startedAtMs:1,completedAtMs:2,checks:[0,1,2]});
    expect(available(d.challenges.find(c=>c.id==='c3d-alignment')!,d)).toBe(true);
  });
  it('previews weekly assignments with the same rotation as the native assigner',()=>{
    const d=data();d.settings={automatic:true,tracks:['AutoCAD','Civil 3D','Revit'],difficulties:['Beginner','Intermediate','Advanced'],weeklyCount:1};
    // Reference values: hash = fold(h*31+byte) over the Monday string, modulo the id-ordered pool of nine (5 and 3).
    expect(weeklyPreview(d,'2026-11-02').map(c=>c.id)).toEqual(['c3d-survey']);
    expect(weeklyPreview(d,'2026-11-09').map(c=>c.id)).toEqual(['c3d-survey']);
    d.settings.weeklyCount=2;expect(weeklyPreview(d,'2026-11-09').map(c=>c.id)).toEqual(['c3d-survey','revit-bim']);
    d.settings={automatic:true,tracks:['AutoCAD'],difficulties:['Beginner','Intermediate','Advanced'],weeklyCount:3};
    expect(weeklyPreview(d,'2026-11-09').map(c=>c.id)).toEqual(['acad-drafting']);
    expect(weeklyPreview(d,'2026-11-02').map(c=>c.id)).toEqual(['acad-drafting']);
  });
  it('previews nothing when automatic is off, the week is full, or work is complete',()=>{
    const d=data();d.settings={automatic:false,tracks:['AutoCAD'],difficulties:['Beginner'],weeklyCount:2};
    expect(weeklyPreview(d,'2026-11-09')).toEqual([]);
    d.settings.automatic=true;expect(weeklyPreview(d,'2026-11-09').map(c=>c.id)).toEqual(['acad-drafting']);
    d.assignments.push({id:'2026-11-09:revit-bim',weekStart:'2026-11-09',challengeId:'revit-bim',contentVersion:1,source:'manual',status:'Not Started'});
    expect(weeklyPreview(d,'2026-11-09').map(c=>c.id)).toEqual(['acad-drafting']);
    d.settings.weeklyCount=1;expect(weeklyPreview(d,'2026-11-09')).toEqual([]);
    d.assignments=[];d.progress.push({challengeId:'acad-drafting',contentVersion:1,mode:'guided',status:'Completed',notes:'',deadlineDate:null,startedAtMs:1,completedAtMs:2,checks:[0,1,2]});
    expect(weeklyPreview(d,'2026-11-09')).toEqual([]);
  });
  it('counts completed objectives deterministically without implying competency',()=>{
    const d=data();const before=skillProgress(d).find(s=>s.id==='surfaces')!;expect(before.completed).toBe(0);
    d.progress.push({challengeId:'c3d-survey',contentVersion:1,mode:'guided',status:'Completed',notes:'',deadlineDate:null,startedAtMs:1,completedAtMs:2,checks:[0,1,2]});
    expect(skillProgress(d).find(s=>s.id==='surfaces')?.completed).toBe(3);
  });
  it('creates one usable project from a challenge with its existing evidence in browser preview',async()=>{
    const challenge=library[0]!;
    await addChallengeEvidence(challenge.id,'C:\\Synthetic\\drawing.dwg');
    const id=await createChallengeProject(challenge.id);
    expect(await createChallengeProject(challenge.id)).toBe(id);
    const projects=await loadProjects();
    const value=projects.projects.find(p=>p.id===id);
    expect(value).toMatchObject({title:challenge.title,discipline:challenge.discipline,portfolioCandidate:false});
    expect(projects.files.filter(f=>f.projectId===id)).toEqual([expect.objectContaining({displayName:'drawing.dwg',path:'C:\\Synthetic\\drawing.dwg'})]);
    expect((await loadChallenges()).projects.filter(link=>link.challengeId===challenge.id)).toHaveLength(1);
  });
});
