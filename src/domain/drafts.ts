import { areaLabels, type Area } from './areas';
import type { Task, TaskInput } from '../services/workspace';

export function taskDraft(task?: Task, area: Area = 'personal'): TaskInput {
  return task ? { id: task.id, title: task.title, description: task.description, category: task.category, priority: task.priority, dueDate: task.dueDate, dueTime: task.dueTime, subtasks: task.subtasks, reminderOffsetMinutes: task.reminderOffsetMinutes }
    : { id: crypto.randomUUID(), title: '', description: '', category: areaLabels[area], priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null };
}
