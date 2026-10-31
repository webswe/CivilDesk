import { Bell, CalendarDays, CircleHelp, FolderKanban, GraduationCap, Home, Lightbulb, BookOpen, Settings2, Sparkles, Target, Timer, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Page ids are stable routes. Several existing pages keep their original ids so no workflow breaks. */
export interface NavItem { id: string; label: string; icon: LucideIcon }
export interface NavGroup { id: string; label: string; icon: LucideIcon; items: NavItem[] }
export type NavEntry = NavItem | NavGroup;
export const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

export const mainNav: NavEntry[] = [
  { id: 'Dashboard', label: 'My Day', icon: Home },
  { id: 'School', label: 'School', icon: GraduationCap },
  { id: 'Personal', label: 'Personal', icon: User },
  { id: 'engineering', label: 'Engineering', icon: FolderKanban, items: [
    { id: 'Projects', label: 'Projects', icon: FolderKanban },
    { id: 'Weekly Challenges', label: 'Challenges', icon: Lightbulb },
    { id: 'Skills', label: 'Skills', icon: Target },
    { id: 'Engineering Journal', label: 'Journal', icon: BookOpen },
  ] },
  { id: 'Calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'Focus Sessions', label: 'Focus', icon: Timer },
  { id: 'Pip', label: 'Pip', icon: Sparkles },
];
export const utilityNav: NavItem[] = [
  { id: 'Notifications', label: 'Reminders', icon: Bell },
  { id: 'Settings', label: 'Settings', icon: Settings2 },
  { id: 'About and Updates', label: 'About', icon: CircleHelp },
];
/** Pages without a nav item of their own, mapped to the item that should look active. */
const parents: Record<string, string> = { Tasks: 'Dashboard', 'Engineering Tasks': 'Projects', Customization: 'Pip', Achievements: 'Pip' };
export const pageTitles: Record<string, string> = { Tasks: 'All tasks', 'Engineering Tasks': 'Engineering tasks', Customization: 'Wardrobe', Achievements: 'Achievements' };

export function allItems(): NavItem[] { return [...mainNav.flatMap(e => isGroup(e) ? e.items : [e]), ...utilityNav]; }
export function pageLabel(id: string): string { return pageTitles[id] ?? allItems().find(i => i.id === id)?.label ?? id; }
/** The nav item that should be highlighted, and its group (for the breadcrumb and auto-expansion). */
export function locate(id: string): { activeId: string; group: NavGroup | null } {
  const activeId = parents[id] ?? id;
  const group = mainNav.filter(isGroup).find(g => g.items.some(i => i.id === activeId)) ?? null;
  return { activeId, group };
}
