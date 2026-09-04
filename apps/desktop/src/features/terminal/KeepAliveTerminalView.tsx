import { useEffect, useRef } from "react"

import {
  adoptTerminalViewInto,
  useTerminalViewKeepAlive,
} from "@/features/projects/terminals/terminalViewKeepAlive"

/**
 * Adopts the long-lived terminal view (see terminalViewKeepAlive.ts) into
 * the calling tile's DOM. The xterm React subtree lives in TerminalViewHost
 * and is reparented here — unmounting the tile parks the view instead of
 * paying a full xterm rebuild on the next visit.
 */
export function KeepAliveTerminalView({
  terminalId,
  workspaceId,
  focused,
}: {
  terminalId: string
  workspaceId: string | null
  focused: boolean
}) {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const attach = useTerminalViewKeepAlive((state) => state.attach)
  const detach = useTerminalViewKeepAlive((state) => state.detach)
  const setFocused = useTerminalViewKeepAlive((state) => state.setFocused)
  const focusedRef = useRef(focused)
  focusedRef.current = focused

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    attach({ terminalId, workspaceId, focused: focusedRef.current })
    const release = adoptTerminalViewInto(target, terminalId)
    return () => {
      release()
      detach(terminalId)
    }
    // focused intentionally excluded: focus changes must not re-adopt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach, detach, terminalId, workspaceId])

  useEffect(() => {
    setFocused(terminalId, focused)
  }, [focused, setFocused, terminalId])

  return <div ref={targetRef} className="h-full min-h-0 w-full" />
}
