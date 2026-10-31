import { beforeEach, describe, expect, it } from 'vitest';
import { claimReminder, inQuietHours, localInstant, reminderCandidates } from './calendar';
import { previewWorkspace } from './workspace';

describe('local scheduling and reminder claims', () => {
  beforeEach(() => { previewWorkspace().tasks = []; previewWorkspace().events = []; });
  it('rejects nonexistent local dates and distinguishes task deadlines from events', () => {
    expect(localInstant('2025-02-29','10:00')).toBeNull();
    const due = localInstant('2026-11-03','10:00')!;
    previewWorkspace().tasks.push({ id:'task',title:'Review plan',description:'',category:'',priority:'normal',dueDate:'2026-11-03',dueTime:'10:00',subtasks:[],reminderOffsetMinutes:15,createdAtMs:0,updatedAtMs:0,completedAtMs:null,firstCompletedAtMs:null,projectId:null });
    previewWorkspace().events.push({ id:'event',title:'Studio review',description:'',startDate:'2026-11-03',startTime:'10:00',endDate:'2026-11-03',endTime:'11:00',allDay:false,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,startAtMs:due,endAtMs:due+3600000,reminderOffsetMinutes:5,createdAtMs:0,updatedAtMs:0 });
    const candidates = reminderCandidates(previewWorkspace(),due-20*60000);
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c=>c.kind)).toEqual(['task','event']);
    expect(candidates[0]?.scheduledAtMs).toBe(due-15*60000);
  });
  it('suppresses duplicate claims and respects overnight quiet hours', async () => {
    const key='unique-'+crypto.randomUUID();
    expect(await claimReminder('task',key,123)).toBe(true);
    expect(await claimReminder('task',key,123)).toBe(false);
    const prefs={enabled:true,quietStart:'22:00',quietEnd:'08:00'};
    expect(inQuietHours(new Date(2026,1,1,23,0),prefs)).toBe(true);
    expect(inQuietHours(new Date(2026,1,2,7,59),prefs)).toBe(true);
    expect(inQuietHours(new Date(2026,1,2,8,0),prefs)).toBe(false);
  });
  it('rejects a DST gap and chooses the first repeated hour in New York', () => {
    expect(localInstant('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    expect(localInstant('2026-11-01', '01:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
});
