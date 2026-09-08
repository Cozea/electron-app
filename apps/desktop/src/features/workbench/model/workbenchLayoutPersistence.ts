import type { SerializedDockview } from 'dockview-react';
import { buildWorkbenchScopeKey } from '@/lib/workbenchScopeKey';
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient';

interface LayoutData { layout: SerializedDockview | null; layoutResetKey: number }
function isSerializedDockview(value: unknown): value is SerializedDockview {
  return Boolean(value && typeof value === 'object' && 'grid' in value && 'panels' in value);
}

/** Cold activation awaits this barrier; a resident session has no persistence work on reveal. */
export function ensureWorkbenchLayoutPersistenceReady(scopeKey?: string): Promise<void> {
  return desktopPersistenceClient.hydrateNamespace('workbenchLayout', scopeKey ? [scopeKey] : undefined);
}
export function isWorkbenchLayoutPersistenceReady(scopeKey: string): boolean {
  return desktopPersistenceClient.isHydrated('workbenchLayout', scopeKey);
}
export function subscribeWorkbenchLayouts(listener: () => void): () => void {
  return desktopPersistenceClient.subscribeNamespace('workbenchLayout', listener);
}
export function getWorkbenchLayoutsRevision(): number {
  return desktopPersistenceClient.getNamespaceVersion('workbenchLayout');
}

export interface PendingWorkbenchLayoutWrite {
  scopeKey: string;
  layoutResetKey: number;
  layout: SerializedDockview;
}
export function isWorkbenchLayoutWriteStillValid(
  pending: Pick<PendingWorkbenchLayoutWrite, 'scopeKey' | 'layoutResetKey'>,
  current: { scopeKey: string | null | undefined; layoutResetKey: number },
): boolean {
  return Boolean(pending.scopeKey) && pending.scopeKey === current.scopeKey && pending.layoutResetKey === current.layoutResetKey;
}

/** Strictly a memory lookup. It never reads localStorage or parses a collection. */
export function peekPersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number): SerializedDockview | null {
  const layout = desktopPersistenceClient.peekLayout(scopeKey, layoutResetKey);
  return isSerializedDockview(layout) ? layout : null;
}
export function writePersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number, layout: SerializedDockview): void {
  const existing = desktopPersistenceClient.peekRecord<LayoutData>('workbenchLayout', scopeKey);
  if (existing?.data.layout === layout && existing.data.layoutResetKey === layoutResetKey) return;
  desktopPersistenceClient.queueDirtyRecord('workbenchLayout', scopeKey, { layout, layoutResetKey });
}
export function clearPersistedWorkbenchLayout(scopeKey: string): Promise<void> {
  return desktopPersistenceClient.deleteRecord('workbenchLayout', scopeKey);
}
export function clearPersistedWorkbenchLayoutsForProject(projectId: string): Promise<void> {
  const normalized = projectId.trim();
  return normalized ? desktopPersistenceClient.clearLayoutsForProject(normalized) : Promise.resolve();
}

export async function clonePersistedWorkbenchLayout(sourceScopeKey: string, targetScopeKey: string, resetKey: number): Promise<boolean> {
  await desktopPersistenceClient.hydrateNamespace('workbenchLayout', [sourceScopeKey, targetScopeKey]);
  if (sourceScopeKey === targetScopeKey || desktopPersistenceClient.peekRecord('workbenchLayout', targetScopeKey)) return false;
  const source = peekPersistedWorkbenchLayout(sourceScopeKey, resetKey);
  if (!source) return false;
  writePersistedWorkbenchLayout(targetScopeKey, resetKey, source);
  return true;
}
export function clonePersistedWorkbenchLayoutToWorkspace(
  projectId: string, laneId: string, sourceWorkspaceId: string | null | undefined, targetWorkspaceId: string, resetKey: number,
): Promise<boolean> {
  return clonePersistedWorkbenchLayout(buildWorkbenchScopeKey(projectId, laneId, sourceWorkspaceId),
    buildWorkbenchScopeKey(projectId, laneId, targetWorkspaceId), resetKey);
}

/** Explicit relink operation: clone only this project's chosen source workspace; never overwrite targets. */
export async function clonePersistedWorkbenchLayoutsForWorkspace(args: {
  projectId: string; fromWorkspace?: string | null; toWorkspace?: string | null;
}): Promise<void> {
  const projectId = args.projectId.trim();
  const targetWorkspace = args.toWorkspace?.trim();
  if (!projectId || !targetWorkspace) return;
  await ensureWorkbenchLayoutPersistenceReady();
  for (const [scopeKey, record] of desktopPersistenceClient.peekNamespace<LayoutData>('workbenchLayout')) {
    const parts = scopeKey.split('::');
    if (parts[0] !== projectId || !parts[1] || parts.length < 4 || !/^v\d+$/.test(parts.at(-1) ?? '')) continue;
    const sourceWorkspace = parts.slice(2, -1).join('::');
    if (args.fromWorkspace?.trim() && sourceWorkspace !== args.fromWorkspace.trim()) continue;
    const targetScope = buildWorkbenchScopeKey(projectId, parts[1], targetWorkspace);
    if (desktopPersistenceClient.peekRecord('workbenchLayout', targetScope)) continue;
    if (record.data.layout) writePersistedWorkbenchLayout(targetScope, record.data.layoutResetKey, record.data.layout);
  }
}
export const clonePersistedWorkbenchLayoutsToWorkspace = clonePersistedWorkbenchLayoutsForWorkspace;
