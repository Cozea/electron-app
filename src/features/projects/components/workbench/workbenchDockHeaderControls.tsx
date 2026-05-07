import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react"

interface WorkbenchDockHeaderControls {
  controls?: ReactNode
  actions?: ReactNode
}

type HeaderControlsListener = () => void

const headerControlsByPanelId = new Map<string, WorkbenchDockHeaderControls>()
const listeners = new Set<HeaderControlsListener>()
let headerControlsVersion = 0

function emitHeaderControlsChange() {
  headerControlsVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

function subscribeHeaderControls(listener: HeaderControlsListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getHeaderControlsSnapshot() {
  return headerControlsVersion
}

export function useWorkbenchDockHeaderControls(
  panelId: string | null | undefined,
): WorkbenchDockHeaderControls | null {
  useSyncExternalStore(
    subscribeHeaderControls,
    getHeaderControlsSnapshot,
    getHeaderControlsSnapshot,
  )

  if (!panelId) {
    return null
  }

  return headerControlsByPanelId.get(panelId) ?? null
}

export function useRegisterWorkbenchDockHeaderControls(
  panelId: string,
  controls: WorkbenchDockHeaderControls,
) {
  useEffect(() => {
    if (!controls.controls && !controls.actions) {
      headerControlsByPanelId.delete(panelId)
      emitHeaderControlsChange()
      return
    }

    headerControlsByPanelId.set(panelId, controls)
    emitHeaderControlsChange()

    return () => {
      headerControlsByPanelId.delete(panelId)
      emitHeaderControlsChange()
    }
  }, [controls, panelId])
}
