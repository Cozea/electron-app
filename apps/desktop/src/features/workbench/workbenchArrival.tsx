import { useEffect, useState } from "react"

/**
 * A workbench "arrives" when its session mounts or returns to the foreground
 * after a project or page switch. Arrival must paint fully formed in one frame:
 * motion is for actions taken inside the workbench, not for navigating to it.
 *
 * While settling, the session host carries `data-workbench-arrival="settling"`,
 * which turns off CSS transitions for its subtree (workbench.css). Lifting that
 * is safe because removing a transition never starts one. Workbench content
 * has no enter animations: those would play on every arrival.
 */

// Covers tiles mounting from the restored layout and the first round of state
// they resolve (loading icons, measured launcher density).
export const WORKBENCH_ARRIVAL_SETTLE_MS = 320

interface ArrivalState {
  isActive: boolean
  settling: boolean
}

/**
 * True while the session is arriving. Settles `WORKBENCH_ARRIVAL_SETTLE_MS`
 * after the session is both foreground and ready (dockview restored its layout).
 */
export function useWorkbenchArrival(isActive: boolean, isReady: boolean): boolean {
  const [arrival, setArrival] = useState<ArrivalState>(() => ({ isActive, settling: isActive }))

  // Derived during render rather than in an effect, so the commit that makes
  // the session visible already carries the settling attribute.
  if (arrival.isActive !== isActive) {
    setArrival({ isActive, settling: isActive })
  }

  useEffect(() => {
    if (!arrival.settling || !isReady) return
    const timer = window.setTimeout(() => {
      setArrival((current) => (current === arrival ? { ...current, settling: false } : current))
    }, WORKBENCH_ARRIVAL_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [arrival, isReady])

  return arrival.settling
}
