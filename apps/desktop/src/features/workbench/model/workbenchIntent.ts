/**
 * In-app workbench intents travel via navigation state, not URL search params.
 *
 * The previous design encoded lane/tile intents in the URL
 * (`?lane=…&openTile=…&focusTile=…`), which a sync hook consumed and then
 * stripped with a replace-navigation — costing two to three router
 * transitions per click and re-rendering the route tree each time. Navigation
 * state carries the same intent with zero URL churn and no cleanup pass.
 *
 * Search params remain supported (see useProjectWorkbenchSearchParamSync) as
 * the deep-link decoder for external entry points; new in-app flows should use
 * this module instead.
 */
import type { WorkbenchTileType } from "@/lib/workbenchTileContract"

export interface WorkbenchIntent {
  laneId?: string | null
  openTile?: Extract<WorkbenchTileType, "assistantChat" | "devServer" | "terminal">
  /** Creation/folder opening reuses an existing tile instead of adding another. */
  ensureTile?: Extract<WorkbenchTileType, "assistantChat" | "devServer" | "terminal">
  focusTileId?: string | null
  openDevAppPreview?: {
    relativePath: string
    sourceProjectId?: string | null
    sourceWorkspaceId?: string | null
    sourceRef?: string | null
  }
}

export interface WorkbenchIntentNavigationState {
  workbenchIntent?: WorkbenchIntent
}

export function buildWorkbenchIntentState(intent: WorkbenchIntent): WorkbenchIntentNavigationState {
  return { workbenchIntent: intent }
}

export function readWorkbenchIntentFromState(state: unknown): WorkbenchIntent | null {
  if (!state || typeof state !== "object") return null
  const intent = (state as WorkbenchIntentNavigationState).workbenchIntent
  if (!intent || typeof intent !== "object") return null
  return intent
}

interface WorkbenchIntentScope {
  projectId: string | null
  workspaceId: string | null
  targetProjectId: string | null
  targetWorkspaceId: string | null
  visible: boolean
}

/** A retained surface must wait until it owns the navigation's destination. */
export function canApplyWorkbenchIntentToScope(scope: WorkbenchIntentScope): boolean {
  if (!scope.visible || !scope.projectId) return false
  if (scope.targetProjectId && scope.targetProjectId !== scope.projectId) return false
  if (scope.targetWorkspaceId && scope.targetWorkspaceId !== scope.workspaceId) return false
  return true
}

// Intent application must be idempotent across component remounts (StrictMode
// double-effects, surface remounts) and history back-navigation: the state
// object persists per history entry, so track applied intents by identity.
const appliedIntents = new WeakSet<WorkbenchIntent>()

export function wasWorkbenchIntentApplied(intent: WorkbenchIntent): boolean {
  return appliedIntents.has(intent)
}

export function markWorkbenchIntentApplied(intent: WorkbenchIntent): void {
  appliedIntents.add(intent)
}
