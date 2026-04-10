import { useEffect, useState } from "react"
import type { DockviewPanelApi } from "dockview"

function getPanelActivityMode(panelApi: DockviewPanelApi): "visible" | "hidden" {
  return panelApi.isActive && panelApi.isVisible ? "visible" : "hidden"
}

export function useWorkbenchPanelActivityMode(panelApi: DockviewPanelApi): "visible" | "hidden" {
  const [mode, setMode] = useState<"visible" | "hidden">(() => getPanelActivityMode(panelApi))

  useEffect(() => {
    setMode(getPanelActivityMode(panelApi))

    const activeDisposable = panelApi.onDidActiveChange(() => {
      setMode(getPanelActivityMode(panelApi))
    })
    const visibilityDisposable = panelApi.onDidVisibilityChange(() => {
      setMode(getPanelActivityMode(panelApi))
    })

    return () => {
      activeDisposable.dispose()
      visibilityDisposable.dispose()
    }
  }, [panelApi])

  return mode
}
