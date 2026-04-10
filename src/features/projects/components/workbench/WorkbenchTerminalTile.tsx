import { Activity, useEffect, useRef, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import { ArrowPathIcon as Loader2, CommandLineIcon as TerminalSquare } from "@heroicons/react/24/outline"

import { Button } from "@/components/ui/button"
import { TerminalInstance } from "@/features/projects/components/TerminalInstance"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import { useTerminalStore } from "@/stores/useTerminalStore"

interface WorkbenchTerminalTileProps {
  projectId: string
  laneId: string
  tileId: string
  projectPath: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchTerminalTile({
  projectId,
  laneId,
  tileId,
  projectPath,
  panelApi,
  containerApi,
}: WorkbenchTerminalTileProps) {
  const activityMode = useWorkbenchPanelActivityMode(panelApi)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const replaceTerminalOutput = useTerminalStore((state) => state.actions.replaceTerminalOutput)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const terminalIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!terminalId) {
      return
    }

    setTerminalUiAttached(terminalId, activityMode === "visible")
  }, [activityMode, setTerminalUiAttached, terminalId])

  useEffect(() => {
    if (!projectPath) {
      setTerminalId(null)
      return
    }

    let cancelled = false

    void (async () => {
      setError(null)

      await window.electronAPI.workbenchSession.ensureSession({
        projectId,
        laneId,
        projectPath,
      })
      if (cancelled) return

      let nextTerminalId = await window.electronAPI.workbenchSession.getTerminalBinding({
        projectId,
        laneId,
        tileId,
      })

      let snapshot =
        nextTerminalId
          ? await window.electronAPI.terminal.getSnapshot({ terminalId: nextTerminalId })
          : null

      if (!snapshot || !nextTerminalId) {
        const result = await window.electronAPI.terminal.create({
          projectPath,
          cwd: projectPath,
        })

        if (cancelled) {
          return
        }

        if (!result.success || !result.terminalId) {
          setError(result.error ?? "Failed to create a terminal")
          return
        }

        nextTerminalId = result.terminalId
        await window.electronAPI.workbenchSession.bindTerminal({
          projectId,
          laneId,
          tileId,
          terminalId: result.terminalId,
          projectPath,
        })
        snapshot = await window.electronAPI.terminal.getSnapshot({
          terminalId: result.terminalId,
        })
      }

      if (!nextTerminalId || cancelled) {
        return
      }

      const info = await window.electronAPI.terminal.getInfo({ terminalId: nextTerminalId })
      if (cancelled) return

      terminalIdRef.current = nextTerminalId
      setTerminalId(nextTerminalId)
      registerTerminal({
        id: nextTerminalId,
        profileId: info?.profileId ?? "default",
        profileName: info?.profileName ?? "Shell",
        title: info?.title ?? "Shell",
        projectPath,
        kind: "shell",
        surface: "panel",
        status: snapshot?.running === false ? "exited" : "running",
        exitCode: snapshot?.exitCode ?? null,
        hasOutput: Boolean(snapshot?.stdout?.length),
        uiAttached: true,
      })
      replaceTerminalOutput(nextTerminalId, snapshot?.stdout ?? "")
      setTerminalUiAttached(nextTerminalId, true)
    })()

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
    projectPath,
    registerTerminal,
    replaceTerminalOutput,
    setTerminalUiAttached,
    tileId,
  ])

  let body: ReactNode

  if (!projectPath) {
    body = (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Open or relink a local project folder to start a terminal here.
      </div>
    )
  } else if (error) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TerminalSquare className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(null)
            setTerminalId(null)
            terminalIdRef.current = null
          }}
        >
          Retry
        </Button>
      </div>
    )
  } else if (!terminalId) {
    body = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing terminal…
      </div>
    )
  } else {
    body = (
      <Activity mode={activityMode} name={`workbench-terminal-${tileId}`}>
        <div className="h-full min-h-0 p-1">
          <TerminalInstance
            terminalId={terminalId}
            className="h-full workbench-terminal-instance"
            gpuActive={activityMode === "visible"}
          />
        </div>
      </Activity>
    )
  }

  return (
    <WorkbenchTileChrome title="Terminal" panelApi={panelApi} containerApi={containerApi}>
      <div className="h-full min-h-0">{body}</div>
    </WorkbenchTileChrome>
  )
}
