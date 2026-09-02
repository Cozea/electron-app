import { useEffect, useMemo, useState } from "react"
import type { DockviewPanelApi } from "dockview-react"

import { useOptionalWorkbenchDockRuntime } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"

export interface WorkbenchPanelActivityState {
  mode: "visible" | "hidden"
  visible: boolean
  focused: boolean
}

const HIDDEN_ACTIVITY_STATE: WorkbenchPanelActivityState = {
  mode: "hidden",
  visible: false,
  focused: false,
}

function readPanelActivityState(panelApi: DockviewPanelApi): WorkbenchPanelActivityState {
  const visible = panelApi.isVisible
  const focused = visible && panelApi.isActive
  return {
    mode: visible ? "visible" : "hidden",
    visible,
    focused,
  }
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
  const surfaceVisible = useOptionalWorkbenchDockRuntime()?.surfaceVisible ?? true
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
          previous.mode === next.mode
        ) {
          return previous
        }
        return next
      })
    }

    sync()
    return subscribePanelActivity(panelApi, sync)
  }, [panelApi])

  return useMemo(() => {
    if (!surfaceVisible) {
      return HIDDEN_ACTIVITY_STATE
    }
    return state
  }, [state, surfaceVisible])
}
