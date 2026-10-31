import { describe, expect, it } from 'vitest';
import { allItems, isGroup, locate, mainNav, pageLabel } from './navigation';

describe('navigation', () => {
  it('offers the seven intent-based entries in order', () => {
    expect(mainNav.map(e => e.label)).toEqual(['My Day', 'School', 'Personal', 'Engineering', 'Calendar', 'Focus', 'Pip']);
  });
  it('keeps every engineering destination reachable inside the Engineering group', () => {
    const group = mainNav.find(isGroup)!;
    expect(group.items.map(i => i.id)).toEqual(['Projects', 'Weekly Challenges', 'Skills', 'Engineering Journal']);
  });
  it('has unique page ids and no roadmap placeholders', () => {
    const ids = allItems().map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const gone of ['Courses', 'Grades', 'Goals', 'Habits', 'Analytics', 'Portfolio Manager']) expect(ids).not.toContain(gone);
  });
  it('highlights the parent of sub-pages and reports the group for breadcrumbs', () => {
    expect(locate('Customization').activeId).toBe('Pip');
    expect(locate('Tasks').activeId).toBe('Dashboard');
    expect(locate('Engineering Tasks').group?.label).toBe('Engineering');
    expect(locate('Skills').group?.label).toBe('Engineering');
    expect(locate('Calendar').group).toBeNull();
  });
  it('uses user-facing labels', () => {
    expect(pageLabel('Dashboard')).toBe('My Day');
    expect(pageLabel('Weekly Challenges')).toBe('Challenges');
    expect(pageLabel('Focus Sessions')).toBe('Focus');
    expect(pageLabel('Tasks')).toBe('All tasks');
  });
});
