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
import type { WorkbenchTileType } from "@/stores/useProjectWorkbenchStore"
import type { ProjectDevAppLaunchSpec } from "@/features/devapps/registry/types"

export interface WorkbenchIntent {
  laneId?: string | null
  openTile?: Extract<WorkbenchTileType, "assistantChat" | "terminal">
  focusTileId?: string | null
  projectDevApp?: ProjectDevAppLaunchSpec
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
