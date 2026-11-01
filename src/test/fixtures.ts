import type { WorkspaceData } from '../services/workspace';

/** A fresh, empty workspace for component tests. Each call returns independent objects. */
export function defaultWorkspaceForTests(): WorkspaceData {
  return {
    tasks: [], sessions: [], events: [], reminderPreferences: { enabled: true, quietStart: '22:00', quietEnd: '08:00' }, focusDurationMinutes: 25, breakDurationMinutes: 5,
    progression: { xp: 0, level: 1, earned: [], unlocked: [], styleId: 'classic', scarf: false, headphones: false, history: [] },
  };
}
