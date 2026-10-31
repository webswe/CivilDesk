import { invoke } from '@tauri-apps/api/core';
import { previewWorkspace, type WorkspaceData } from './workspace';
export interface CalendarEvent {
  id:string; title:string; description:string; startDate:string; startTime:string|null;
  endDate:string; endTime:string|null; allDay:boolean; timeZone:string;
  startAtMs:number|null; endAtMs:number|null; reminderOffsetMinutes:number|null;
  createdAtMs:number; updatedAtMs:number;
}
export type CalendarInput = Omit<CalendarEvent,'createdAtMs'|'updatedAtMs'>;
export interface ReminderPreferences { enabled:boolean; quietStart:string; quietEnd:string }
const native = () => '__TAURI_INTERNALS__' in window;
export async function saveEvent(event:CalendarInput):Promise<void>{
  if(native()) return invoke('save_event',{event});
  const data = previewWorkspace();
  const old=data.events.find(e=>e.id===event.id);const now=Date.now();
  data.events=[...data.events.filter(e=>e.id!==event.id),{...event,createdAtMs:old?.createdAtMs??now,updatedAtMs:now}];
}
export async function deleteEvent(id:string):Promise<void>{
  if(native()) return invoke('delete_event',{id});
  const data=previewWorkspace();data.events=data.events.filter(e=>e.id!==id);
}
export async function saveReminderPreferences(p:ReminderPreferences):Promise<void>{
  if(native()) return invoke('save_reminder_preferences',{enabled:p.enabled,quietStart:p.quietStart,quietEnd:p.quietEnd});
  const data=previewWorkspace();data.reminderPreferences=p;
}
const previewClaims=new Set<string>();
export async function claimReminder(kind:'task'|'event',id:string,scheduledAtMs:number):Promise<boolean>{
  if(native()) return invoke<boolean>('claim_reminder',{kind,id,scheduledAtMs});
  const key=kind+':'+id+':'+scheduledAtMs;
  if(previewClaims.has(key))return false;
  previewClaims.add(key);return true;
}
export function reminderCandidates(data:WorkspaceData,now:number):{kind:'task'|'event';id:string;title:string;dueAtMs:number;scheduledAtMs:number;overdue:boolean}[]{
  const results:{kind:'task'|'event';id:string;title:string;dueAtMs:number;scheduledAtMs:number;overdue:boolean}[]=[];
  for(const t of data.tasks){
    if(t.completedAtMs||!t.dueDate||t.reminderOffsetMinutes===null)continue;
    const due=localInstant(t.dueDate,t.dueTime||'23:59');if(due===null)continue;
    results.push({kind:'task',id:t.id,title:t.title,dueAtMs:due,scheduledAtMs:due-t.reminderOffsetMinutes*60000,overdue:due<now});
  }
  for(const e of data.events){
    if(e.reminderOffsetMinutes===null)continue;
    const due=e.allDay?localInstant(e.startDate,'09:00'):e.startAtMs;
    if(due===null)continue;
    results.push({kind:'event',id:e.id,title:e.title,dueAtMs:due,scheduledAtMs:due-e.reminderOffsetMinutes*60000,overdue:due<now});
  }
  return results.sort((a,b)=>a.scheduledAtMs-b.scheduledAtMs);
}
export function localInstant(date:string,time:string,zone=Intl.DateTimeFormat().resolvedOptions().timeZone):number|null{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;
  const [y,m,d]=date.split('-').map(Number);const [h,min]=time.split(':').map(Number);
  if(!y||!m||!d||h===undefined||min===undefined||h>23||min>59)return null;
  const utc=(year:number,month:number,day:number,hour:number,minute:number)=>{const value=new Date(0);value.setUTCFullYear(year,month-1,day);value.setUTCHours(hour,minute,0,0);return value.getTime();};
  const naive=utc(y,m,d,h,min);
  const check=new Date(naive);
  if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return null;
  try{
    const format=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const parts=(epoch:number)=>{const values=Object.fromEntries(format.formatToParts(epoch).map(p=>[p.type,Number(p.value)]));return [values.year,values.month,values.day,values.hour,values.minute];};
    const offsets=new Set([naive-86400000,naive,naive+86400000].map(epoch=>{const p=parts(epoch);return utc(p[0]!,p[1]!,p[2]!,p[3]!,p[4]!)-epoch;}));
    const matches=[...offsets].map(offset=>naive-offset).filter(epoch=>{const p=parts(epoch);return p[0]===y&&p[1]===m&&p[2]===d&&p[3]===h&&p[4]===min;});
    return matches.length?Math.min(...matches):null;
  }catch{return null;}
}
export function inQuietHours(now:Date,p:ReminderPreferences):boolean{
  const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  if(p.quietStart===p.quietEnd)return false;
  return p.quietStart<p.quietEnd?time>=p.quietStart&&time<p.quietEnd:time>=p.quietStart||time<p.quietEnd;
}
