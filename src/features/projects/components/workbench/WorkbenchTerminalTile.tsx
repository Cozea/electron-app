import { Activity, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"

import { Button } from "@/components/ui/button"
import {
  TerminalInstance,
  type TerminalAttachResolution,
  type TerminalAttachSize,
} from "@/features/projects/components/TerminalInstance"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import { useTerminalStore } from "@/stores/useTerminalStore"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerTerminal01Icon as __ComputerTerminalHugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchTerminalTileProps {
  projectId: string
  laneId: string
  tileId: string
  projectPath: string | null
  workbenchSession: WorkbenchSessionSnapshot | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchTerminalTile({
  projectId,
  laneId,
  tileId,
  projectPath,
  workbenchSession,
  panelApi,
  containerApi,
}: WorkbenchTerminalTileProps) {
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const terminalIdRef = useRef<string | null>(null)

  const terminalShell = (
    <div className="h-full min-h-0 pt-1.5 pr-1.5 pb-1.5 pl-2.5">
      <div
        className="h-full w-full rounded-[4px]"
        style={{ backgroundColor: "var(--terminal-panel-bg, var(--content-surface))" }}
      />
    </div>
  )

  useEffect(() => {
    if (!terminalId) {
      return
    }

    setTerminalUiAttached(terminalId, panelActivity.visible)
  }, [panelActivity.visible, setTerminalUiAttached, terminalId])

  useEffect(() => {
    const activeTerminalId = terminalIdRef.current
    if (activeTerminalId) {
      setTerminalUiAttached(activeTerminalId, false)
    }
    setTerminalId(null)
    terminalIdRef.current = null
    setError(null)
  }, [laneId, projectId, projectPath, setTerminalUiAttached, tileId, workbenchSession?.sessionKey])

  useEffect(() => {
    return () => {
      const activeTerminalId = terminalIdRef.current
      if (!activeTerminalId) return
      setTerminalUiAttached(activeTerminalId, false)
      terminalIdRef.current = null
    }
  }, [setTerminalUiAttached])

  const resolveTerminal = useCallback(
    async ({ cols, rows }: TerminalAttachSize): Promise<TerminalAttachResolution> => {
      if (!projectPath || !workbenchSession?.sessionKey) {
        throw new Error("Open or relink a local project folder to start a terminal here.")
      }

      setError(null)

      let nextTerminalId = await window.electronAPI.workbenchSession.getTerminalBinding({
        sessionKey: workbenchSession.sessionKey,
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
          gitCwd: projectPath,
          cols,
          rows,
          sessionKey: workbenchSession.sessionKey,
          laneId,
          terminalKind: "shell",
          activityTracking: "off",
        })

        if (!result.success || !result.terminalId) {
          throw new Error(result.error ?? "Failed to create a terminal")
        }

        nextTerminalId = result.terminalId
        await window.electronAPI.workbenchSession.bindTerminal({
          sessionKey: workbenchSession.sessionKey,
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

      const info = await window.electronAPI.terminal.getInfo({ terminalId: nextTerminalId })

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
        uiAttached: panelActivity.visible,
      })
      setTerminalUiAttached(nextTerminalId, panelActivity.visible)
      terminalIdRef.current = nextTerminalId
      setTerminalId(nextTerminalId)

      return {
        terminalId: nextTerminalId,
        snapshot,
        info,
      }
    },
    [
      laneId,
      panelActivity.visible,
      projectId,
      projectPath,
      registerTerminal,
      setTerminalUiAttached,
      tileId,
      workbenchSession?.sessionKey,
    ],
  )

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
          }}
        >
          Retry
        </Button>
      </div>
    )
  } else if (!workbenchSession?.sessionKey) {
    body = terminalShell
  } else {
    body = (
      <Activity mode={panelActivity.mode} name={`workbench-terminal-${tileId}`}>
        <div className="h-full min-h-0 pt-1.5 pr-1.5 pb-1.5 pl-2.5">
          <TerminalInstance
            key={`${workbenchSession.sessionKey}:${projectId}:${laneId}:${tileId}:${projectPath}`}
            resolveTerminal={resolveTerminal}
            onTerminalError={setError}
            projectPath={projectPath}
            className="h-full workbench-terminal-instance"
            shouldAutoFocus={panelActivity.focused}
            gpuActive={panelActivity.visible}
          />
        </div>
      </Activity>
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
