export type Engagement = 'quiet' | 'balanced' | 'playful';
export type PipState = 'awake' | 'happy' | 'curious' | 'relaxed' | 'bored' | 'sleepy' | 'sleeping' | 'startled' | 'affectionate' | 'focused' | 'celebrating';
export interface Preferences {
  displayName: string;
  onboardingComplete: boolean;
  pipVisible: boolean;
  engagement: Engagement;
  reducedMotion: boolean;
  focusMode: boolean;
  sidebarCollapsed: boolean;
  dashboardPipEnabled: boolean;
}
export interface CompanionRecord { state: PipState; experience: number; level: number; coins: number; updatedAt: string }
export interface AppSnapshot { preferences: Preferences; companion: CompanionRecord }
export const defaultSnapshot: AppSnapshot = {
  preferences: { displayName: '', onboardingComplete: false, pipVisible: true, engagement: 'balanced', reducedMotion: false, focusMode: false, sidebarCollapsed: false, dashboardPipEnabled: true },
  companion: { state: 'awake', experience: 0, level: 1, coins: 0, updatedAt: new Date(0).toISOString() },
};

// Phase 2 contracts. Reward evaluation stays independent of the renderer.
export interface RewardEvent { id: string; kind: string; sourceId: string; occurredAt: string }
export interface AchievementDefinition { id: string; ruleVersion: number; title: string; eventKind: string }
export interface EarnedAchievement { definitionId: string; ruleVersion: number; eventId: string; earnedAt: string }
export interface CosmeticUnlock { cosmeticId: string; sourceEventId: string; unlockedAt: string }
export interface CustomizationSelection { styleId: string; accessoryIds: string[]; environmentId: string }
