import { useEffect, useRef, useState } from "react"

import { useTerminalStore, type TerminalKind } from "@/features/terminal/model/terminalStore"

interface UseWorkbenchSessionTerminalOptions {
  workspaceId: string | null
  workbenchSessionKey: string | null
  projectId: string
  laneId: string
  tileId: string
  terminalKind: Extract<TerminalKind, "shell" | "dev-server">
  /**
   * Poll the pty for a live foreground process (main process, once a second)
   * and emit `terminal.activity`. Off by default: each tracked terminal costs a
   * `pgrep` spawn per second, so only surfaces that display the signal opt in.
   */
  trackSubprocessActivity?: boolean
  /** Fixed display title for registration; defaults to the PTY's own title. */
  title?: string | null
  /** Drives uiAttached; read through a ref so flips never re-run the binding. */
  visible: boolean
  /** Bump to retry after an error. */
  retryKey?: number
}

// PTY allocation can fail transiently (macOS pseudo-terminal pool pressure:
// openpty ENXIO "Device not configured"). Retry a couple of times before
// surfacing the error — a failed create must not brick the tile forever.
const MAX_AUTO_RETRIES = 2
const AUTO_RETRY_BASE_DELAY_MS = 1200

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
  trackSubprocessActivity = false,
  title = null,
  visible,
  retryKey = 0,
}: UseWorkbenchSessionTerminalOptions): { terminalId: string | null; error: string | null } {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoRetrySeq, setAutoRetrySeq] = useState(0)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const terminalIdRef = useRef<string | null>(null)
  const attemptRef = useRef(0)
  const attemptIdentityRef = useRef<string | null>(null)
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
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    // Fresh binding identity (or an explicit user retry) resets the
    // auto-retry budget; auto-retry re-runs keep consuming it.
    const attemptIdentity = [workspaceId, workbenchSessionKey, projectId, laneId, tileId, terminalKind, retryKey].join('|')
    if (attemptIdentityRef.current !== attemptIdentity) {
      attemptIdentityRef.current = attemptIdentity
      attemptRef.current = 0
    }

    const failOrRetry = (message: string) => {
      if (cancelled) return
      if (attemptRef.current < MAX_AUTO_RETRIES) {
        attemptRef.current += 1
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            setAutoRetrySeq((current) => current + 1)
          }
        }, AUTO_RETRY_BASE_DELAY_MS * attemptRef.current)
        return
      }
      setError(message)
    }

    void (async () => {
      setError(null)
      setTerminalId(null)

      let nextTerminalId = await window.electronAPI.workbenchSession.getTerminalBinding({
        sessionKey: workbenchSessionKey,
        projectId,
        laneId,
        tileId,
      })

      // Closing the last Dev Server surface intentionally keeps its PTY and
      // process alive. A new tile has a new id, so it cannot recover that PTY
      // from the workbench binding alone; ask the process registry for the
      // owning terminal before allocating an unrelated empty shell.
      if (!nextTerminalId && terminalKind === "dev-server") {
        const processState = await window.electronAPI.devServer.getState({
          workspaceId,
          laneId,
        })
        const processTerminalId = processState.running ? processState.terminalId : null
        const processSnapshot = processTerminalId
          ? await window.electronAPI.terminal.getSnapshot({ terminalId: processTerminalId })
          : null
        if (processTerminalId && processSnapshot?.running !== false) {
          nextTerminalId = processTerminalId
          await window.electronAPI.workbenchSession.bindTerminal({
            sessionKey: workbenchSessionKey,
            projectId,
            laneId,
            tileId,
            terminalId: processTerminalId,
            workspaceId,
          })
          await window.electronAPI.devServer.attachSurface({
            workspaceId,
            laneId,
            terminalId: processTerminalId,
          })
        }
      }

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
          activityTracking: trackSubprocessActivity ? "subprocess" : "off",
        })

        if (cancelled) {
          // The effect was torn down (lane/project switch or unmount) while
          // terminal.create was in flight. The PTY now exists in main but is
          // not bound to any session, so no reaper would ever reclaim it —
          // kill it here to avoid leaking PTYs (macOS openpty ENXIO pool
          // exhaustion; see the note at the top of this file).
          if (result.success && result.terminalId) {
            void window.electronAPI.terminal.kill({ terminalId: result.terminalId })
          }
          return
        }

        if (!result.success || !result.terminalId) {
          failOrRetry(result.error ?? "Failed to prepare the terminal session")
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
      failOrRetry(message)
    })

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      const activeTerminalId = terminalIdRef.current
      if (!activeTerminalId) return
      setTerminalUiAttached(activeTerminalId, false)
      terminalIdRef.current = null
    }
  }, [
    autoRetrySeq,
    laneId,
    projectId,
    registerTerminal,
    retryKey,
    setTerminalUiAttached,
    terminalKind,
    tileId,
    trackSubprocessActivity,
    workbenchSessionKey,
    workspaceId,
  ])

  return { terminalId, error }
}
