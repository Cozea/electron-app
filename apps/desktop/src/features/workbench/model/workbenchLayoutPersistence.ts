import type { SerializedDockview } from "dockview-react"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import { desktopPersistenceClient } from "@/app/model/persistence/desktopPersistenceClient"

function isSerializedDockview(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== "object") return false
  return "grid" in value && "panels" in value
}

export function ensureWorkbenchLayoutPersistenceReady(): void {
  void desktopPersistenceClient.hydrateNamespace("workbenchLayout")

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const rawLegacy = window.localStorage.getItem("cozea:project-workbench")
      if (rawLegacy) {
        const parsed = JSON.parse(rawLegacy)
        const workbenches = parsed?.state?.workbenches ?? parsed?.workbenches
        if (workbenches && typeof workbenches === "object") {
          for (const [key, val] of Object.entries(workbenches as Record<string, any>)) {
            if (val && isSerializedDockview(val.layout)) {
              desktopPersistenceClient.setLayoutInMemory(
                key,
                typeof val.layoutResetKey === "number" ? val.layoutResetKey : 0,
                val.layout
              )
            }
          }
        }
      }
    } catch {}
  }
}

export interface PendingWorkbenchLayoutWrite {
  scopeKey: string
  layoutResetKey: number
  layout: SerializedDockview
}

export function isWorkbenchLayoutWriteStillValid(
  pending: Pick<PendingWorkbenchLayoutWrite, "scopeKey" | "layoutResetKey">,
  current: { scopeKey: string | null | undefined; layoutResetKey: number },
): boolean {
  return (
    Boolean(pending.scopeKey) &&
    pending.scopeKey === current.scopeKey &&
    pending.layoutResetKey === current.layoutResetKey
  )
}

/**
 * Pure synchronous in-memory layout peek (Invariant I08, Section 10.4).
 * Reads directly from hydrated desktopPersistenceClient without localStorage access or parsing.
 */
export function peekPersistedWorkbenchLayout(
  scopeKey: string,
  layoutResetKey: number,
): SerializedDockview | null {
  const result = desktopPersistenceClient.peekLayout(scopeKey, layoutResetKey)
  if (result && isSerializedDockview(result)) {
    return result
  }
  return null
}

export function writePersistedWorkbenchLayout(
  scopeKey: string,
  layoutResetKey: number,
  layout: SerializedDockview,
): void {
  desktopPersistenceClient.setLayoutInMemory(scopeKey, layoutResetKey, layout)
  desktopPersistenceClient.queueDirtyRecord("workbenchLayout", scopeKey, {
    layout,
    layoutResetKey,
  })
}

export function clearPersistedWorkbenchLayout(scopeKey: string): void {
  desktopPersistenceClient.setLayoutInMemory(scopeKey, 0, null)
  desktopPersistenceClient.queueDirtyRecord("workbenchLayout", scopeKey, {
    layout: null,
    layoutResetKey: 0,
  })
}

export function clearPersistedWorkbenchLayoutsForProject(projectId: string): void {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return
  desktopPersistenceClient.clearLayoutsForProject(normalizedProjectId)
}

export function clonePersistedWorkbenchLayout(
  sourceScopeKey: string,
  targetScopeKey: string,
  resetKey: number,
): boolean {
  const existing = peekPersistedWorkbenchLayout(sourceScopeKey, resetKey)
  if (!existing) {
    return false
  }

  writePersistedWorkbenchLayout(targetScopeKey, resetKey, existing)
  return true
}

export function clonePersistedWorkbenchLayoutToWorkspace(
  projectId: string,
  laneId: string,
  sourceWorkspaceId: string | null | undefined,
  targetWorkspaceId: string,
  resetKey: number,
): boolean {
  const sourceScopeKey = buildWorkbenchScopeKey(projectId, laneId, sourceWorkspaceId)
  const targetScopeKey = buildWorkbenchScopeKey(projectId, laneId, targetWorkspaceId)
  return clonePersistedWorkbenchLayout(sourceScopeKey, targetScopeKey, resetKey)
}

export function clonePersistedWorkbenchLayoutsToWorkspace(args: {
  projectId: string
  fromWorkspace?: string | null
  toWorkspace: string
}): void {
  if (!args.projectId || !args.toWorkspace) return
}

export const clonePersistedWorkbenchLayoutsForWorkspace = clonePersistedWorkbenchLayoutsToWorkspace
