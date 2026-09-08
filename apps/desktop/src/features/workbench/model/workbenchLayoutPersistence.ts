import type { SerializedDockview } from 'dockview-react'
import { buildWorkbenchScopeKey } from '@/lib/workbenchScopeKey'
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient'

interface LayoutData { layout: SerializedDockview | null; layoutResetKey: number }
function isLayout(value: unknown): value is SerializedDockview { return value !== null && typeof value === 'object' && 'grid' in value && 'panels' in value }
export function ensureWorkbenchLayoutPersistenceReady(scopeKey?: string): Promise<void> {
  return desktopPersistenceClient.hydrateNamespace('workbenchLayout', scopeKey ? [scopeKey] : undefined)
}
export interface PendingWorkbenchLayoutWrite { scopeKey: string; layoutResetKey: number; layout: SerializedDockview }
export function isWorkbenchLayoutWriteStillValid(pending: Pick<PendingWorkbenchLayoutWrite, 'scopeKey' | 'layoutResetKey'>, current: { scopeKey: string | null | undefined; layoutResetKey: number }): boolean {
  return Boolean(pending.scopeKey) && pending.scopeKey === current.scopeKey && pending.layoutResetKey === current.layoutResetKey
}
export function peekPersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number): SerializedDockview | null {
  const value = desktopPersistenceClient.peekLayout(scopeKey, layoutResetKey)
  return isLayout(value) ? value : null
}
export function writePersistedWorkbenchLayout(scopeKey: string, layoutResetKey: number, layout: SerializedDockview): void {
  desktopPersistenceClient.queueDirtyRecord('workbenchLayout', scopeKey, { layout, layoutResetKey })
}
export function clearPersistedWorkbenchLayout(scopeKey: string): void { desktopPersistenceClient.deleteRecord('workbenchLayout', scopeKey) }
export async function clearPersistedWorkbenchLayoutsForProject(projectId: string): Promise<void> {
  if (!projectId.trim()) return
  await ensureWorkbenchLayoutPersistenceReady()
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())
}
export function clonePersistedWorkbenchLayout(sourceScopeKey: string, targetScopeKey: string, resetKey: number): boolean {
  const layout = peekPersistedWorkbenchLayout(sourceScopeKey, resetKey)
  if (!layout) return false
  writePersistedWorkbenchLayout(targetScopeKey, resetKey, layout)
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
    const parts = record.key.split('::')
    if (parts.length < 4 || parts[0] !== args.projectId || !parts[parts.length - 1]?.startsWith('v')) continue
    const laneId = parts[1]
    const source = parts.slice(2, -1).join('::')
    if (!laneId || !source || (args.fromWorkspace?.trim() && args.fromWorkspace.trim() !== source)) continue
    const data = record.data as LayoutData
    if (!data || !isLayout(data.layout) || !Number.isInteger(data.layoutResetKey)) continue
    const targetKey = buildWorkbenchScopeKey(args.projectId, laneId, target)
    if (desktopPersistenceClient.peek('workbenchLayout', targetKey) !== undefined) continue
    writePersistedWorkbenchLayout(targetKey, data.layoutResetKey, data.layout)
  }
}
export const clonePersistedWorkbenchLayoutsToWorkspace = clonePersistedWorkbenchLayoutsForWorkspace
