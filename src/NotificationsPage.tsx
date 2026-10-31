import { useState } from 'react';
import { reminderCandidates, type ReminderPreferences } from './services/calendar';
import type { WorkspaceData } from './services/workspace';

export function NotificationsPage({ data, save }: { data: WorkspaceData; save: (p: ReminderPreferences) => Promise<void> }) {
  const [draft, setDraft] = useState(data.reminderPreferences);
  const now = Date.now();
  const items = reminderCandidates(data, now);
  const overdue = items.filter(x => x.dueAtMs < now);
  const upcoming = items.filter(x => x.dueAtMs >= now);
  return <div className="page-panel wide-panel"><h1>Reminders</h1><p>Reminders appear while CivilDesk is open. Quiet hours hold alerts until your next active window.</p><div className="setting-group"><h2>Preferences</h2><label className="setting-row"><span><strong>Enable reminders</strong><small>Show grouped reminders in the app when due</small></span><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })}/></label><div className="form-grid"><label>Quiet hours start<input type="time" value={draft.quietStart} onChange={e => setDraft({ ...draft, quietStart: e.target.value })}/></label><label>Quiet hours end<input type="time" value={draft.quietEnd} onChange={e => setDraft({ ...draft, quietEnd: e.target.value })}/></label></div><button className="primary-button" onClick={() => void save(draft)}>Save reminder preferences</button></div><div className="reminder-columns"><section><h2>Upcoming</h2>{upcoming.length ? <ul className="simple-list">{upcoming.map(x => <li key={x.kind + x.id}><span>{x.title}<small>{x.kind === 'task' ? 'Task deadline' : 'Calendar event'}</small></span><small>{new Date(x.dueAtMs).toLocaleString()}</small></li>)}</ul> : <p>No upcoming reminders. Add an offset to a task or event to schedule one.</p>}</section><section><h2>Overdue</h2>{overdue.length ? <ul className="simple-list">{overdue.map(x => <li key={x.kind + x.id}><span>{x.title}<small>{x.kind === 'task' ? 'Task deadline' : 'Calendar event'}</small></span><small>{new Date(x.dueAtMs).toLocaleString()}</small></li>)}</ul> : <p>Nothing overdue.</p>}</section></div></div>;
}
