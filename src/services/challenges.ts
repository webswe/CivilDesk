import { invoke } from '@tauri-apps/api/core';
import library from '../../src-tauri/src/challenge_library.json';
import { saveProject, saveProjectFile } from './projects';

export type Challenge = typeof library[number];
export type ChallengeStatus = 'Not Started'|'In Progress'|'Completed'|'Skipped';
export interface ChallengeSettings { automatic: boolean; tracks: string[]; difficulties: string[]; weeklyCount: number }
export interface Assignment { id:string; weekStart:string; challengeId:string; contentVersion:number; source:'automatic'|'manual'; status:ChallengeStatus }
export interface Progress { challengeId:string; contentVersion:number; mode:'guided'|'brief'; status:Exclude<ChallengeStatus,'Not Started'>; notes:string; deadlineDate:string|null; startedAtMs:number; completedAtMs:number|null; checks:number[] }
export interface Evidence { id:string; challengeId:string; displayName:string; path:string; category:string; addedAtMs:number; missing:boolean }
export interface Pathway { id:string; title:string; description:string; track:string; challengeIds:string[] }
export interface ChallengeProject { challengeId:string; projectId:string; createdFromChallenge:boolean }
export interface ChallengeData { challenges:Challenge[]; versions:Challenge[]; settings:ChallengeSettings; assignments:Assignment[]; progress:Progress[]; evidence:Evidence[]; pathways:Pathway[]; projects:ChallengeProject[] }
const native=()=> '__TAURI_INTERNALS__' in window;
const preview:ChallengeData={challenges:structuredClone(library),versions:structuredClone(library),settings:{automatic:false,tracks:['AutoCAD','Civil 3D','Revit'],difficulties:['Beginner','Intermediate','Advanced'],weeklyCount:2},assignments:[],progress:[],evidence:[],pathways:[{id:'cad-foundations',title:'AutoCAD drawing practice',description:'Optional sequence',track:'AutoCAD',challengeIds:['acad-drafting','acad-site-plan','acad-layout']},{id:'roadway-concepts',title:'Civil 3D roadway concepts',description:'Optional sequence',track:'Civil 3D',challengeIds:['c3d-survey','c3d-alignment','c3d-roadway']},{id:'bim-documentation',title:'Revit model to documents',description:'Optional sequence',track:'Revit',challengeIds:['revit-bim','revit-foundation','revit-docs']}],projects:[]};
export const loadChallenges=async():Promise<ChallengeData>=>native()?invoke('load_challenges'):structuredClone(preview);
export function weekStart(date=new Date()):string { const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()-(date.getDay()+6)%7);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
export function nextWeek(date=new Date()):string { const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()+7);return weekStart(d); }
export function available(challenge:Challenge,data:ChallengeData):boolean {return challenge.prerequisites.every(id=>data.progress.some(p=>p.challengeId===id&&p.status==='Completed'));}
/** Mirrors `assign_week` in challenges.rs: rotate the id-ordered track/difficulty pool by a Monday hash, then skip ineligible entries. */
export function weeklyPreview(data:ChallengeData,week:string):Challenge[]{
  const assigned=data.assignments.filter(a=>a.weekStart===week);
  const open=data.settings.weeklyCount-assigned.length;
  if(!data.settings.automatic||open<=0)return [];
  const pool=data.challenges.filter(c=>data.settings.tracks.includes(c.track)&&data.settings.difficulties.includes(c.difficulty)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!pool.length)return [];
  let hash=0;for(const character of week)hash=(Math.imul(hash,31)+character.charCodeAt(0))>>>0;
  const start=hash%pool.length;
  const picks:Challenge[]=[];
  for(let i=0;i<pool.length&&picks.length<open;i++){
    const c=pool[(start+i)%pool.length];
    if(!c||assigned.some(a=>a.challengeId===c.id)||!available(c,data)||data.progress.some(p=>p.challengeId===c.id&&p.status==='Completed'))continue;
    picks.push(c);
  }
  return picks;
}
export function skillProgress(data:ChallengeData):{id:string;track:string;completed:number;total:number}[]{const keys=new Map<string,{id:string;track:string;completed:number;total:number}>();for(const latest of data.challenges){const p=data.progress.find(x=>x.challengeId===latest.id);const challenge=(p&&data.versions.find(x=>x.id===latest.id&&x.version===p.contentVersion))||latest;for(const id of challenge.skills){const key=keys.get(id)||{id,track:challenge.track,completed:0,total:0};key.total+=challenge.objectives.length;if(p?.status==='Completed')key.completed+=challenge.objectives.length;keys.set(id,key)}}return [...keys.values()].sort((a,b)=>a.track.localeCompare(b.track)||a.id.localeCompare(b.id));}
export async function saveChallengeSettings(settings:ChallengeSettings){if(native())return invoke<void>('save_challenge_settings',{settings});preview.settings=settings;}
export async function assignWeek(week:string,manual:string|null=null){if(native())return invoke<void>('assign_week',{week,manual});const selected=manual?preview.challenges.filter(c=>c.id===manual):weeklyPreview(preview,week);for(const c of selected)if(!preview.assignments.some(a=>a.weekStart===week&&a.challengeId===c.id))preview.assignments.push({id:week+':'+c.id,weekStart:week,challengeId:c.id,contentVersion:c.version,source:manual?'manual':'automatic',status:'Not Started'});}
export async function challengeAction(id:string,action:string,options:{mode?:string;notes?:string;deadline?:string|null;check?:number}={}){const week=weekStart();if(native())return invoke<void>('challenge_action',{id,action,week,mode:options.mode??null,notes:options.notes??null,deadline:options.deadline??null,check:options.check??null});let p=preview.progress.find(x=>x.challengeId===id);if(action==='start'&&!p){p={challengeId:id,contentVersion:preview.challenges.find(c=>c.id===id)?.version||1,mode:(options.mode||'guided') as 'guided',status:'In Progress',notes:'',deadlineDate:null,startedAtMs:Date.now(),completedAtMs:null,checks:[]};preview.progress.push(p)}if(!p)return;if(action==='start'){p.mode=(options.mode||p.mode) as 'guided';p.status='In Progress'}if(action==='notes')p.notes=options.notes||'';if(action==='deadline')p.deadlineDate=options.deadline||null;if(action==='check'&&!p.checks.includes(options.check!))p.checks.push(options.check!);if(action==='uncheck')p.checks=p.checks.filter(x=>x!==options.check);if(action==='complete'){p.status='Completed';p.completedAtMs??=Date.now()}if(action==='skip')p.status='Skipped';for(const a of preview.assignments.filter(a=>a.challengeId===id&&a.weekStart===week))if(['start','complete','skip'].includes(action))a.status=p.status;}
export async function addChallengeEvidence(challengeId:string,path:string){const id=crypto.randomUUID();if(native())return invoke<void>('add_challenge_evidence',{id,challengeId,path});preview.evidence.push({id,challengeId,path,displayName:path.split(/[\\/]/).pop()||path,category:path.split('.').pop()||'',addedAtMs:Date.now(),missing:false});}
export async function removeChallengeEvidence(id:string){if(native())return invoke<void>('remove_challenge_evidence',{id});preview.evidence=preview.evidence.filter(x=>x.id!==id);}
export async function linkChallengeProject(challengeId:string,projectId:string){if(native())return invoke<void>('link_challenge_project',{challengeId,projectId});if(!preview.projects.some(x=>x.challengeId===challengeId&&x.projectId===projectId))preview.projects.push({challengeId,projectId,createdFromChallenge:false});}
export async function createChallengeProject(challengeId:string):Promise<string>{
  if(native())return invoke('create_challenge_project',{challengeId});
  const existing=preview.projects.find(x=>x.challengeId===challengeId&&x.createdFromChallenge);
  if(existing)return existing.projectId;
  const challenge=preview.challenges.find(c=>c.id===challengeId);
  if(!challenge)throw new Error('Challenge not found');
  const id='challenge-'+challengeId;
  await saveProject({id,title:challenge.title,description:challenge.description,discipline:challenge.discipline,category:'Learning challenge',projectType:'Educational',software:[challenge.track],startDate:null,targetDate:null,status:'Planning',priority:'normal',createdAtMs:0,updatedAtMs:0,completedAtMs:null,portfolioCandidate:false,portfolioSummary:'',objectives:challenge.objectives.join('\n'),contributions:'',skills:challenge.skills.join(', '),decisions:'',lessons:''});
  for(const file of preview.evidence.filter(e=>e.challengeId===challengeId))await saveProjectFile({id:id+':'+file.id,projectId:id,displayName:file.displayName,path:file.path,category:file.category,description:'Linked from learning challenge',addedAtMs:file.addedAtMs,missing:file.missing});
  preview.projects.push({challengeId,projectId:id,createdFromChallenge:true});
  return id;
}
