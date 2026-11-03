import type { DataSourceView, DatabaseView, PageView, SelectedSource } from '../services/notion';

/** What the workspace is showing. `ds` is a data source (the table); `db` is a database container that holds data sources. They are different identifiers. */
export type ResourceKind = 'page' | 'ds' | 'db';
export interface Resource { kind: ResourceKind; id: string; name: string; icon?: string | null }
export interface TreeChildren { items: Resource[]; cursor: string | null; more: boolean }

/**
 * Session-only memory for the workspace: lives until the app closes or Notion is disconnected, is never written to
 * disk, and holds names and identifiers only (never the credential).
 */
export interface WorkspaceSession {
  stack: Resource[]; index: number; recents: Resource[]; sidebarOpen: boolean | null; sidebarWidth: number;
  expanded: Record<string, boolean>; tree: Map<string, TreeChildren>;
  pages: Map<string, Promise<PageView>>; sources: Map<string, Promise<DataSourceView>>; databases: Map<string, Promise<DatabaseView>>;
  shared: { items: Resource[]; cursor: string | null; more: boolean } | null;
  /** Which connection this memory belongs to. A different workspace or a reconnect starts clean. */
  identity: string | null;
}
const fresh = (): WorkspaceSession => ({ stack: [], index: -1, recents: [], sidebarOpen: null, sidebarWidth: 280, expanded: {}, tree: new Map(), pages: new Map(), sources: new Map(), databases: new Map(), shared: null, identity: null });
export const session: WorkspaceSession = fresh();
export function resetWorkspaceSession() { Object.assign(session, fresh()); }
/** Cached lookups drop failures so a retry really retries. */
export function cached<T>(map: Map<string, Promise<T>>, id: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(id); if (hit) return hit;
  const p = load(); map.set(id, p); p.catch(() => { if (map.get(id) === p) map.delete(id); }); return p;
}
export const fromSaved = (s: SelectedSource): Resource => ({ kind: s.resourceType === 'page' ? 'page' : 'ds', id: s.resourceId, name: s.displayName });
export const MAX_RECENTS = 8;
