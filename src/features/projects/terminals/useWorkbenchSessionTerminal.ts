import { useEffect, useRef, useState } from "react"

import { useTerminalStore, type TerminalKind } from "@/stores/useTerminalStore"

interface UseWorkbenchSessionTerminalOptions {
  workspaceId: string | null
  workbenchSessionKey: string | null
  projectId: string
  laneId: string
  tileId: string
  terminalKind: Extract<TerminalKind, "shell" | "dev-server">
  /** Fixed display title for registration; defaults to the PTY's own title. */
  title?: string | null
  /** Drives uiAttached; read through a ref so flips never re-run the binding. */
  visible: boolean
  /** Bump to retry after an error. */
  retryKey?: number
}

/**
 * Resolves the session-bound terminal for a workbench tile: reuse the
 * session's existing binding when its PTY is still alive, otherwise create a
 * fresh terminal and bind it. Shared by the shell tile and the dev-server
 * tile so the two flows can't drift apart again.
 */
export function useWorkbenchSessionTerminal({
  workspaceId,
  workbenchSessionKey,
  projectId,
  laneId,
  tileId,
  terminalKind,
  title = null,
  visible,
  retryKey = 0,
}: UseWorkbenchSessionTerminalOptions): { terminalId: string | null; error: string | null } {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const terminalIdRef = useRef<string | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const titleRef = useRef(title)
  titleRef.current = title

  useEffect(() => {
    if (!terminalId) return
    setTerminalUiAttached(terminalId, visible)
  }, [setTerminalUiAttached, terminalId, visible])

  useEffect(() => {
    if (!workspaceId || !workbenchSessionKey) {
      const activeTerminalId = terminalIdRef.current
      if (activeTerminalId) {
        setTerminalUiAttached(activeTerminalId, false)
      }
      terminalIdRef.current = null
      setTerminalId(null)
      setError(null)
      return
    }

    let cancelled = false

    void (async () => {
      setError(null)
      setTerminalId(null)

      let nextTerminalId = await window.electronAPI.workbenchSession.getTerminalBinding({
        sessionKey: workbenchSessionKey,
        projectId,
        laneId,
        tileId,
      })

      let snapshot =
        nextTerminalId
          ? await window.electronAPI.terminal.getSnapshot({ terminalId: nextTerminalId })
          : null
      let info = null

      if (!snapshot || !nextTerminalId) {
        const result = await window.electronAPI.terminal.create({
          workspaceId,
          cwd: { kind: "projectRoot" },
          gitCwd: { kind: "gitRoot" },
          sessionKey: workbenchSessionKey,
          laneId,
          terminalKind,
          activityTracking: "off",
        })

        if (cancelled) {
          return
        }

        if (!result.success || !result.terminalId) {
          setError(result.error ?? "Failed to prepare the terminal session")
          return
        }

        nextTerminalId = result.terminalId
        snapshot = result.snapshot ?? null
        info = result.info ?? null
        await window.electronAPI.workbenchSession.bindTerminal({
          sessionKey: workbenchSessionKey,
          projectId,
          laneId,
          tileId,
          terminalId: result.terminalId,
          workspaceId,
        })
        if (!snapshot) {
          snapshot = await window.electronAPI.terminal.getSnapshot({
            terminalId: result.terminalId,
          })
        }
      }

      if (cancelled || !nextTerminalId) {
        return
      }

      info = info ?? await window.electronAPI.terminal.getInfo({ terminalId: nextTerminalId })
      if (cancelled) {
        return
      }
      const isVisible = visibleRef.current

      registerTerminal({
        id: nextTerminalId,
        profileId: info?.profileId ?? "default",
        profileName: info?.profileName ?? "Shell",
        title: titleRef.current ?? info?.title ?? "Shell",
        workspaceId,
        kind: terminalKind,
        surface: "panel",
        status: snapshot?.running === false ? "exited" : "running",
        exitCode: snapshot?.exitCode ?? null,
        hasOutput: Boolean(snapshot?.stdout?.length),
        uiAttached: isVisible,
      })
      setTerminalUiAttached(nextTerminalId, isVisible)
      terminalIdRef.current = nextTerminalId
      setTerminalId(nextTerminalId)
    })().catch((nextError) => {
      if (cancelled) {
        return
      }
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Failed to prepare the terminal session"
      setError(message)
    })

    return () => {
      cancelled = true
      const activeTerminalId = terminalIdRef.current
      if (!activeTerminalId) return
      setTerminalUiAttached(activeTerminalId, false)
      terminalIdRef.current = null
    }
  }, [
    laneId,
    projectId,
    registerTerminal,
    retryKey,
    setTerminalUiAttached,
    terminalKind,
    tileId,
    workbenchSessionKey,
    workspaceId,
  ])

  return { terminalId, error }
}
