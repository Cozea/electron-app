import type { SerializedDockview } from 'dockview-react'
import { buildWorkbenchScopeKey, parseWorkbenchScopeKey } from '@/lib/workbenchScopeKey'
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient'

interface LayoutData { layout: SerializedDockview | null; layoutResetKey: number }
function isLayout(value: unknown): value is SerializedDockview {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { grid?: unknown; panels?: unknown }
  return candidate.grid !== null && typeof candidate.grid === 'object' &&
    candidate.panels !== null && typeof candidate.panels === 'object'
}
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
  // Dockview can emit teardown/intermediate shapes while the UI tree is being
  // replaced. TypeScript's SerializedDockview annotation does not protect this
  // runtime persistence boundary. Never overwrite the last known-good layout
  // with a degenerate snapshot that the restore path will reject on next boot.
  if (!isLayout(layout)) {
    console.warn('[WorkbenchLayout] Refused to persist an invalid Dockview snapshot', {
      scopeKey,
      layoutResetKey,
    })
    return
  }
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
export async function clonePersistedWorkbenchLayout(sourceScopeKey: string, targetScopeKey: string, resetKey: number): Promise<boolean> {
  await ensureWorkbenchLayoutPersistenceReady(sourceScopeKey)
  const record = desktopPersistenceClient.entries('workbenchLayout').find(candidate => candidate.key === sourceScopeKey)
  const data = record?.data as LayoutData | undefined
  if (!record || !data || data.layoutResetKey !== resetKey || !isLayout(data.layout)) return false
  writePersistedWorkbenchLayout(targetScopeKey, resetKey, data.layout, record.bindingRevision)
  return true
}
export async function clonePersistedWorkbenchLayoutToWorkspace(projectId: string, laneId: string, sourceWorkspaceId: string | null | undefined, targetWorkspaceId: string, resetKey: number): Promise<boolean> {
  return await clonePersistedWorkbenchLayout(buildWorkbenchScopeKey(projectId, laneId, sourceWorkspaceId), buildWorkbenchScopeKey(projectId, laneId, targetWorkspaceId), resetKey)
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
