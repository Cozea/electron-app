import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"

interface WorkbenchDockHeaderControls {
  controls?: ReactNode
  actions?: ReactNode
}

type HeaderControlsListener = () => void

// Registrations and notifications are scoped per panel id. Panels re-register
// on every render (the registered ReactNodes never keep identity), so a global
// version + listener set would broadcast every panel render to every dock tab
// and header — which rang back and forth across the whole dock chrome on each
// click. Scoping the subscription means a panel render only re-renders its own
// header controls.
const headerControlsByPanelId = new Map<string, WorkbenchDockHeaderControls>()
const versionByPanelId = new Map<string, number>()
const listenersByPanelId = new Map<string, Set<HeaderControlsListener>>()

function emitHeaderControlsChange(panelId: string) {
  versionByPanelId.set(panelId, (versionByPanelId.get(panelId) ?? 0) + 1)
  const panelListeners = listenersByPanelId.get(panelId)
  if (!panelListeners) return
  for (const listener of panelListeners) {
    listener()
  }
}

const noopSubscribe = () => () => {}
const zeroSnapshot = () => 0

export function useWorkbenchDockHeaderControls(
  panelId: string | null | undefined,
): WorkbenchDockHeaderControls | null {
  const subscribe = useCallback(
    (listener: HeaderControlsListener) => {
      if (!panelId) return () => {}
      let panelListeners = listenersByPanelId.get(panelId)
      if (!panelListeners) {
        panelListeners = new Set()
        listenersByPanelId.set(panelId, panelListeners)
      }
      panelListeners.add(listener)
      return () => {
        panelListeners.delete(listener)
        if (panelListeners.size === 0) {
          listenersByPanelId.delete(panelId)
        }
      }
    },
    [panelId],
  )
  const getSnapshot = useCallback(
    () => (panelId ? (versionByPanelId.get(panelId) ?? 0) : 0),
    [panelId],
  )

  useSyncExternalStore(
    panelId ? subscribe : noopSubscribe,
    panelId ? getSnapshot : zeroSnapshot,
    panelId ? getSnapshot : zeroSnapshot,
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
  const registeredRef = useRef<WorkbenchDockHeaderControls | null>(null)

  // Drops this instance's registration, but never a replacement's: panels are
  // torn down and recreated with the same id (dock rebuilds, tile fallbacks),
  // and a stale unmount must not wipe the successor's entry.
  const unregister = useCallback(() => {
    if (
      registeredRef.current &&
      headerControlsByPanelId.get(panelId) === registeredRef.current
    ) {
      headerControlsByPanelId.delete(panelId)
      emitHeaderControlsChange(panelId)
    }
    registeredRef.current = null
  }, [panelId])

  // Layout effect, not passive: the header must see the registration before
  // first paint, or the dock renders bare (no URL bar/actions) for as long as
  // the main thread stays busy after a tile mounts — most visibly during
  // project switches.
  useLayoutEffect(() => {
    if (!controls.controls && !controls.actions) {
      unregister()
      return
    }

    headerControlsByPanelId.set(panelId, controls)
    registeredRef.current = controls
    emitHeaderControlsChange(panelId)
  }, [controls, panelId, unregister])

  useLayoutEffect(() => unregister, [unregister])
}
