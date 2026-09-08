import type { SerializedDockview } from 'dockview-react'
import { buildWorkbenchScopeKey, parseWorkbenchScopeKey } from '@/lib/workbenchScopeKey'
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient'

interface LayoutData { layout: SerializedDockview | null; layoutResetKey: number }
function isLayout(value: unknown): value is SerializedDockview { return value !== null && typeof value === 'object' && 'grid' in value && 'panels' in value }
export function ensureWorkbenchLayoutPersistenceReady(scopeKey?: string): Promise<void> {
  return desktopPersistenceClient.hydrateNamespace('workbenchLayout', scopeKey ? [scopeKey] : undefined)
}
export interface PendingWorkbenchLayoutWrite { scopeKey: string; layoutResetKey: number; bindingRevision: number; layout: SerializedDockview }
export function isWorkbenchLayoutWriteStillValid(pending: Pick<PendingWorkbenchLayoutWrite, 'scopeKey' | 'layoutResetKey'>, current: { scopeKey: string | null | undefined; layoutResetKey: number }): boolean {
  return Boolean(pending.scopeKey) && pending.scopeKey === current.scopeKey && pending.layoutResetKey === current.layoutResetKey
}
export function peekPersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number, bindingRevision?: number): SerializedDockview | null {
  const value = desktopPersistenceClient.peekLayout(scopeKey, layoutResetKey, bindingRevision)
  return isLayout(value) ? value : null
}
export function writePersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number, layout: SerializedDockview, bindingRevision?: number): void {
  desktopPersistenceClient.queueDirtyRecord('workbenchLayout', scopeKey, { layout, layoutResetKey }, bindingRevision)
}
export function clearPersistedWorkbenchLayout(scopeKey: string): void { desktopPersistenceClient.deleteRecord('workbenchLayout', scopeKey) }
export async function clearPersistedWorkbenchLayoutsForProject(projectId: string): Promise<void> {
  if (!projectId.trim()) return
  // Hide known layouts immediately, then tombstone disk-only scopes too.
  // Local tombstones cannot be replaced by the hydration result.
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())
  await ensureWorkbenchLayoutPersistenceReady()
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())
}
export function clonePersistedWorkbenchLayout(sourceScopeKey: string, targetScopeKey: string, resetKey: number): boolean {
  const record = desktopPersistenceClient.entries('workbenchLayout').find(candidate => candidate.key === sourceScopeKey)
  const data = record?.data as LayoutData | undefined
  if (!record || !data || data.layoutResetKey !== resetKey || !isLayout(data.layout)) return false
  writePersistedWorkbenchLayout(targetScopeKey, resetKey, data.layout, record.bindingRevision)
  return true
}
export function clonePersistedWorkbenchLayoutToWorkspace(projectId: string, laneId: string, sourceWorkspaceId: string | null | undefined, targetWorkspaceId: string, resetKey: number): boolean {
  return clonePersistedWorkbenchLayout(buildWorkbenchScopeKey(projectId, laneId, sourceWorkspaceId), buildWorkbenchScopeKey(projectId, laneId, targetWorkspaceId), resetKey)
}
export async function clonePersistedWorkbenchLayoutsForWorkspace(args: { projectId: string; fromWorkspace?: string | null; toWorkspace?: string | null }): Promise<void> {
  const target = args.toWorkspace?.trim()
  if (!args.projectId || !target) return
  await ensureWorkbenchLayoutPersistenceReady()
  for (const record of desktopPersistenceClient.entries('workbenchLayout')) {
    const parsed = parseWorkbenchScopeKey(record.key, args.projectId)
    if (!parsed || (args.fromWorkspace?.trim() && args.fromWorkspace.trim() !== parsed.workspaceId)) continue
    const data = record.data as LayoutData
    if (!data || !isLayout(data.layout) || !Number.isInteger(data.layoutResetKey)) continue
    const targetKey = buildWorkbenchScopeKey(args.projectId, parsed.laneId, target)
    if (desktopPersistenceClient.peek('workbenchLayout', targetKey) !== undefined) continue
    writePersistedWorkbenchLayout(targetKey, data.layoutResetKey, data.layout, record.bindingRevision)
  }
}
export const clonePersistedWorkbenchLayoutsToWorkspace = clonePersistedWorkbenchLayoutsForWorkspace
