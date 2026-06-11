import { useEffect, useRef, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"

import { Button } from "@/components/ui/button"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import {
  adoptTerminalViewInto,
  useTerminalViewKeepAlive,
} from "@/features/projects/terminals/terminalViewKeepAlive"
import { useTerminalStore } from "@/stores/useTerminalStore"

import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerTerminal01Icon as __ComputerTerminalHugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchTerminalTileProps {
  projectId: string
  laneId: string
  tileId: string
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

/**
 * Adopts the long-lived terminal view (see terminalViewKeepAlive.ts) into
 * this tile's DOM. The xterm React subtree lives in TerminalViewHost and is
 * reparented here — unmounting this tile parks the view instead of paying
 * a full xterm rebuild on the next visit.
 */
function KeepAliveTerminalView({
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

export function WorkbenchTerminalTile({
  projectId,
  laneId,
  tileId,
  workspaceId,
  workbenchSessionKey,
  panelApi,
  containerApi,
}: WorkbenchTerminalTileProps) {
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const terminalIdRef = useRef<string | null>(null)

  const terminalShell = (
    <div
      className="h-full min-h-0 w-full"
      style={{ backgroundColor: "var(--terminal-panel-bg, var(--content-surface))" }}
    />
  )

  useEffect(() => {
    if (!terminalId) {
      return
    }

    setTerminalUiAttached(terminalId, panelActivity.visible)
  }, [panelActivity.visible, setTerminalUiAttached, terminalId])

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
          terminalKind: "shell",
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
      const isVisible = panelApi.isVisible

      registerTerminal({
        id: nextTerminalId,
        profileId: info?.profileId ?? "default",
        profileName: info?.profileName ?? "Shell",
        title: info?.title ?? "Shell",
        workspaceId,
        kind: "shell",
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
    panelApi,
    projectId,
    workspaceId,
    registerTerminal,
    retryKey,
    setTerminalUiAttached,
    tileId,
    workbenchSessionKey,
  ])

  let body: ReactNode

  if (!workspaceId) {
    body = (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Open or relink a local project folder to start a terminal here.
      </div>
    )
  } else if (error) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <HugeiconsIcon icon={__ComputerTerminalHugeIcon} className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(null)
            setTerminalId(null)
            terminalIdRef.current = null
            setRetryKey((current) => current + 1)
          }}
        >
          Retry
        </Button>
      </div>
    )
  } else if (!terminalId || !panelActivity.visible) {
    body = terminalShell
  } else {
    body = (
      <KeepAliveTerminalView
        terminalId={terminalId}
        workspaceId={workspaceId}
        focused={panelActivity.focused}
      />
    )
  }

  return (
    <WorkbenchTileChrome
      title="Terminal"
      panelApi={panelApi}
      containerApi={containerApi}
      chromeVariant="pill"
      tileType="terminal"
    >
      <div className="h-full min-h-0">{body}</div>
    </WorkbenchTileChrome>
  )
}
