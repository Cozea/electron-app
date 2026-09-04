import { memo, useEffect } from "react"
import { createPortal } from "react-dom"

import { TerminalInstance } from "@/features/projects/components/TerminalInstance"
import {
  getTerminalParkingLot,
  getTerminalViewMount,
  useTerminalViewKeepAlive,
  type TerminalViewDescriptor,
} from "./terminalViewKeepAlive"

/**
 * Owns the long-lived TerminalInstance React subtrees (see
 * terminalViewKeepAlive.ts). Each view renders through a portal into its
 * stable mount <div>; tiles adopt the mount via DOM reparenting, so project
 * switches never unmount the xterm. GPU rendering and autofocus follow the
 * attached/focused flags, which tiles drive.
 */
const TerminalView = memo(function TerminalView({ view }: { view: TerminalViewDescriptor }) {
  const mount = getTerminalViewMount(view.terminalId)

  useEffect(() => {
    // Newly created mounts start unparented; make sure a detached view's
    // subtree still lives in the (measurable) parking lot, never in limbo.
    if (!mount.parentElement) {
      getTerminalParkingLot().appendChild(mount)
    }
  }, [mount])

  return createPortal(
    <TerminalInstance
      terminalId={view.terminalId}
      workspaceId={view.workspaceId}
      className="h-full workbench-terminal-instance"
      shouldAutoFocus={view.attached && view.focused}
      gpuActive={view.attached}
    />,
    mount,
  )
})

export function TerminalViewHost() {
  const views = useTerminalViewKeepAlive((state) => state.views)

  return (
    <>
      {Object.values(views).map((view) => (
        <TerminalView key={view.terminalId} view={view} />
      ))}
    </>
  )
}
