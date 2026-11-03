import { createContext, useContext, type RefObject } from 'react';
import { NotionError, type SelectedSource } from '../services/notion';
import type { Resource } from './session';

export interface WorkspaceCtx {
  alive: RefObject<boolean>;
  /** Normalises a failure, ignores cancellations, and tells the workspace about auth problems. */
  fail: (e: unknown, set: (e: NotionError) => void) => void;
  open: (r: Resource, opts?: { replace?: boolean }) => void;
  selectedIds: Set<string>;
  onSources: (s: SelectedSource[]) => void;
}
export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);
export function useWorkspace(): WorkspaceCtx { const c = useContext(WorkspaceContext); if (!c) throw new Error('Notion workspace context missing'); return c; }
