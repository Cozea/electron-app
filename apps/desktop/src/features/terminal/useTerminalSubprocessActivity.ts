import { useEffect, useState } from "react"

import {
  resolveTerminalActivity,
  type SidebarActivity,
} from "@/lib/sidebarActivity"

/**
 * Tracks whether a terminal currently has a foreground process.
 *
 * The main process polls the pty once a second (`terminalHost`) and pushes
 * `terminal.activity` whenever the verdict flips, so this only re-renders on a
 * genuine idle↔busy transition rather than on output. The terminal must have
 * been created with subprocess tracking enabled or no events ever arrive.
 */
export function useTerminalSubprocessActivity(terminalId: string | null): SidebarActivity {
  const [hasRunningSubprocess, setHasRunningSubprocess] = useState(false)

  useEffect(() => {
    if (!terminalId) {
      setHasRunningSubprocess(false)
      return
    }

    // Events only report transitions, so a terminal that was already busy when
    // this tile mounted starts out reading idle until its next flip.
    setHasRunningSubprocess(false)

    const unsubscribe = window.electronAPI.terminal.onActivity((event) => {
      if (event.terminalId !== terminalId) return
      setHasRunningSubprocess(event.hasRunningSubprocess)
    })

    return () => {
      unsubscribe?.()
    }
  }, [terminalId])

  return resolveTerminalActivity({
    hasRunningSubprocess,
    isSessionAlive: Boolean(terminalId),
  })
}
