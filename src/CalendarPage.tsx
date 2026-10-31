import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { localDate } from './domain/scheduling';
import { localInstant, type CalendarEvent, type CalendarInput } from './services/calendar';
import type { WorkspaceData } from './services/workspace';

type View = 'month' | 'week' | 'day';
function addDays(date:Date,n:number):Date { const next=new Date(date.getFullYear(),date.getMonth(),date.getDate());next.setDate(next.getDate()+n);return next; }
function localTime(date:Date):string { return String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0'); }
function localRange(event:CalendarEvent) {
  if(event.allDay||event.startAtMs===null||event.endAtMs===null)return {startDate:event.startDate,startTime:event.startTime,endDate:event.endDate,endTime:event.endTime};
  const start=new Date(event.startAtMs);const end=new Date(event.endAtMs);
  return {startDate:localDate(start),startTime:localTime(start),endDate:localDate(end),endTime:localTime(end)};
}
function monday(date:Date):Date { return addDays(date,-((date.getDay()+6)%7)); }
function datesFor(view:View,cursor:Date):Date[] {
  if(view==='day')return [cursor];
  if(view==='week'){const start=monday(cursor);return Array.from({length:7},(_,i)=>addDays(start,i));}
  const start=monday(new Date(cursor.getFullYear(),cursor.getMonth(),1));
  return Array.from({length:42},(_,i)=>addDays(start,i));
}
function draftFor(date:string,event?:CalendarEvent):CalendarInput{
  return event?{id:event.id,title:event.title,description:event.description,...localRange(event),allDay:event.allDay,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,startAtMs:event.startAtMs,endAtMs:event.endAtMs,reminderOffsetMinutes:event.reminderOffsetMinutes}
    :{id:crypto.randomUUID(),title:'',description:'',startDate:date,startTime:'09:00',endDate:date,endTime:'10:00',allDay:false,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,startAtMs:null,endAtMs:null,reminderOffsetMinutes:null};
}
export function CalendarPage({data,save,remove}:{data:WorkspaceData;save:(e:CalendarInput)=>Promise<boolean>;remove:(id:string)=>Promise<void>}) {
  const [view,setView]=useState<View>('month');
  const [cursor,setCursor]=useState(()=>new Date());
  const [selected,setSelected]=useState(localDate());
  const [draft,setDraft]=useState<CalendarInput|null>(null);
  const [details,setDetails]=useState<CalendarEvent|null>(null);
  const [formError,setFormError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(draft)dialog.current?.showModal();else dialog.current?.close();},[draft]);
  const days=datesFor(view,cursor);
  const step=(n:number)=>setCursor(d=>view==='month'?new Date(d.getFullYear(),d.getMonth()+n,Math.min(d.getDate(),28)):addDays(d,n*(view==='week'?7:1)));
  const patch=(v:Partial<CalendarInput>)=>setDraft(d=>d?{...d,...v}:d);
  const eventOn=(e:CalendarEvent,day:string)=>{const range=localRange(e);return range.startDate<=day&&range.endDate>=day;};
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(!draft)return;
    let input:CalendarInput={...draft};
    if(!input.allDay){
      const start=localInstant(input.startDate,input.startTime||'');const end=localInstant(input.endDate,input.endTime||'');
      if(start===null||end===null){setFormError('This local time does not exist in your current time zone. Choose another time.');return;}
      if(end<=start){setFormError('The end must be after the start.');return;}
      input={...input,startAtMs:start,endAtMs:end,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
    }else input={...input,startTime:null,endTime:null,startAtMs:null,endAtMs:null};
    if(await save(input)){setDraft(null);setFormError('');}
  }
  return <div className="page-panel calendar-panel"><div className="page-head"><div><span className="eyebrow">HOME</span><h1>Calendar</h1><p>Events have their own schedule. Task deadlines appear alongside them without creating duplicate events.</p></div><button className="primary-button" onClick={()=>setDraft(draftFor(selected))}><Plus size={16}/> New event</button></div><div className="calendar-toolbar"><div className="button-row"><button className="icon-button" aria-label="Previous period" onClick={()=>step(-1)}><ChevronLeft size={18}/></button><button className="soft-button" onClick={()=>{setCursor(new Date());setSelected(localDate());}}>Today</button><button className="icon-button" aria-label="Next period" onClick={()=>step(1)}><ChevronRight size={18}/></button><strong>{cursor.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong></div><div className="button-row">{(['month','week','day'] as const).map(v=><button key={v} className={view===v?'primary-button':'soft-button'} onClick={()=>setView(v)} aria-pressed={view===v}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>)}</div></div>
    <div className={'calendar-grid '+view}><div className="calendar-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d}>{d}</span>)}</div><div className="calendar-cells">{days.map(day=>{const key=localDate(day);const events=data.events.filter(e=>eventOn(e,key));const tasks=data.tasks.filter(t=>t.dueDate===key&&!t.completedAtMs);return <button key={key} className={'calendar-day '+(key===selected?'selected ':'')+(day.getMonth()!==cursor.getMonth()&&view==='month'?'other-month':'')} onClick={()=>{setSelected(key);setCursor(day);}} aria-label={day.toDateString()+'; '+events.length+' events; '+tasks.length+' task deadlines'}><span className="day-number">{day.getDate()}</span>{events.slice(0,2).map(e=><span className="calendar-chip event" key={e.id}>{e.allDay?'All day':localRange(e).startTime} · {e.title}</span>)}{tasks.slice(0,2).map(t=><span className="calendar-chip deadline" key={t.id}>Due · {t.title}</span>)}{events.length+tasks.length>4&&<small>+{events.length+tasks.length-4} more</small>}</button>;})}</div></div>
    <div className="calendar-detail"><h2>{new Date(selected+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2>{data.events.filter(e=>eventOn(e,selected)).map(e=><article key={e.id} className="calendar-detail-row"><button className="text-link" onClick={()=>setDetails(e)}>{e.title}</button><small>{e.allDay?'All day':localRange(e).startTime+'–'+localRange(e).endTime} · Event</small></article>)}{data.tasks.filter(t=>t.dueDate===selected&&!t.completedAtMs).map(t=><article key={t.id} className="calendar-detail-row"><strong>{t.title}</strong><small>{t.dueTime||'Date only'} · Task deadline</small></article>)}{!data.events.some(e=>eventOn(e,selected))&&!data.tasks.some(t=>t.dueDate===selected&&!t.completedAtMs)&&<p>Nothing scheduled for this day.</p>}{details&&<div className="event-details"><h3>{details.title}</h3><p>{details.description||'No description'}</p><p>{localRange(details).startDate}{details.allDay?' · all day':' '+localRange(details).startTime+' to '+localRange(details).endDate+' '+localRange(details).endTime}<br/>Original zone: {details.timeZone}</p><div className="button-row"><button className="soft-button" onClick={()=>{setDraft(draftFor(details.startDate,details));setDetails(null);}}><Pencil size={14}/> Edit</button><button className="soft-button" onClick={()=>{if(window.confirm('Delete this calendar event?')){void remove(details.id);setDetails(null);}}}><Trash2 size={14}/> Delete</button></div></div>}</div>
    <dialog className="rose-dialog" ref={dialog} onClose={()=>setDraft(null)} aria-labelledby="calendar-dialog-title">{draft&&<form onSubmit={e=>void submit(e)}><h2 id="calendar-dialog-title">{data.events.some(e=>e.id===draft.id)?'Edit event':'New event'}</h2><label>Title<input autoFocus required maxLength={200} value={draft.title} onChange={e=>patch({title:e.target.value})}/></label><label>Description<textarea rows={3} value={draft.description} onChange={e=>patch({description:e.target.value})}/></label><label className="check-row">All-day event<input type="checkbox" checked={draft.allDay} onChange={e=>patch({allDay:e.target.checked})}/></label><div className="form-grid"><label>Start date<input type="date" required value={draft.startDate} onChange={e=>patch({startDate:e.target.value})}/></label>{!draft.allDay&&<label>Start time<input type="time" required value={draft.startTime||''} onChange={e=>patch({startTime:e.target.value})}/></label>}<label>End date<input type="date" required value={draft.endDate} onChange={e=>patch({endDate:e.target.value})}/></label>{!draft.allDay&&<label>End time<input type="time" required value={draft.endTime||''} onChange={e=>patch({endTime:e.target.value})}/></label>}</div><label>Reminder<select value={draft.reminderOffsetMinutes??''} onChange={e=>patch({reminderOffsetMinutes:e.target.value===''?null:Number(e.target.value)})}><option value="">None</option><option value="0">At start</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label><p className="time-zone-note">Timed events use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Times skipped by daylight saving are rejected; repeated times use the first occurrence.</p>{formError&&<p role="alert" className="form-error">{formError}</p>}<div className="dialog-actions"><button type="button" className="soft-button" onClick={()=>setDraft(null)}>Cancel</button><button className="primary-button" type="submit">Save event</button></div></form>}</dialog>
  </div>;
}
