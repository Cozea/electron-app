import { useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import { KeepAliveTerminalView } from "@/features/projects/terminals/KeepAliveTerminalView"
import { useWorkbenchSessionTerminal } from "@/features/projects/terminals/useWorkbenchSessionTerminal"

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
  const [retryKey, setRetryKey] = useState(0)
  const { terminalId, error } = useWorkbenchSessionTerminal({
    workspaceId,
    workbenchSessionKey,
    projectId,
    laneId,
    tileId,
    terminalKind: "shell",
    visible: panelActivity.visible,
    retryKey,
  })

  const terminalShell = (
    <div
      className="h-full min-h-0 w-full"
      style={{ backgroundColor: "var(--terminal-panel-bg, var(--content-surface))" }}
    />
  )

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
