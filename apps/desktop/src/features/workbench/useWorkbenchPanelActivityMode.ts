import { useEffect, useMemo, useState } from "react"
import type { DockviewPanelApi } from "dockview-react"

import { useOptionalWorkbenchSurfaceVisibility } from "@/features/workbench/WorkbenchDockRuntimeContext"

export interface WorkbenchPanelActivityState {
  mode: "visible" | "hidden"
  visible: boolean
  focused: boolean
  /**
   * Visible in its own dock, and its workbench is still the foreground one
   * even if an ordinary page currently covers the surface. Tiles that are
   * costly to park and rebuild stay attached while this holds; anything that
   * paints a native surface must keep gating on `visible`.
   */
  retained: boolean
}

const HIDDEN_ACTIVITY_STATE: WorkbenchPanelActivityState = {
  mode: "hidden",
  visible: false,
  focused: false,
  retained: false,
}

function readPanelActivityState(panelApi: DockviewPanelApi): WorkbenchPanelActivityState {
  const visible = panelApi.isVisible
  const focused = visible && panelApi.isActive
  return {
    mode: visible ? "visible" : "hidden",
    visible,
    focused,
    retained: visible,
  }
}

/**
 * Combines a panel's own dock visibility with its workbench's presentation.
 * A CSS-hidden surface hides every panel, but the foreground workbench's
 * dock-visible panels stay `retained` while an ordinary page covers it.
 */
export function resolveWorkbenchPanelActivity(
  dockState: WorkbenchPanelActivityState,
  surfaceVisible: boolean,
  surfaceForeground: boolean,
): WorkbenchPanelActivityState {
  if (surfaceVisible) return dockState
  return surfaceForeground && dockState.visible
    ? { ...HIDDEN_ACTIVITY_STATE, retained: true }
    : HIDDEN_ACTIVITY_STATE
}

function subscribePanelActivity(
  panelApi: DockviewPanelApi,
  onChange: () => void,
): () => void {
  const activeDisposable = panelApi.onDidActiveChange(onChange)
  const visibilityDisposable = panelApi.onDidVisibilityChange(onChange)
  return () => {
    activeDisposable.dispose()
    visibilityDisposable.dispose()
  }
}

/**
 * Bridges dockview panel visibility/active events into React state.
 * dockview-react still exposes only imperative `api` on panel props — no
 * equivalent hook — so this stays the shared subscription seam.
 */
export function useWorkbenchPanelActivityMode(
  panelApi: DockviewPanelApi,
): WorkbenchPanelActivityState {
  // Dockview only knows about visibility inside its own layout. When the
  // whole workbench is kept alive but CSS-hidden behind another project,
  // panels still report visible, so native surfaces (browser views, embedded
  // previews) would keep painting over the active project. Gate on the
  // surface flag from the dock runtime.
  const surface = useOptionalWorkbenchSurfaceVisibility()
  const surfaceVisible = surface?.surfaceVisible ?? true
  const surfaceForeground = surface?.surfaceForeground ?? surfaceVisible
  const [state, setState] = useState<WorkbenchPanelActivityState>(() =>
    readPanelActivityState(panelApi),
  )

  useEffect(() => {
    const sync = () => {
      setState((previous) => {
        const next = readPanelActivityState(panelApi)
        if (
          previous.visible === next.visible &&
          previous.focused === next.focused &&
          previous.mode === next.mode &&
          previous.retained === next.retained
        ) {
          return previous
        }
        return next
      })
    }

    sync()
    return subscribePanelActivity(panelApi, sync)
  }, [panelApi])

  return useMemo(
    () => resolveWorkbenchPanelActivity(state, surfaceVisible, surfaceForeground),
    [state, surfaceForeground, surfaceVisible],
  )
}
