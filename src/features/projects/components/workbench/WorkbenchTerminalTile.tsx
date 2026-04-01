import { useEffect, useRef, useState } from "react"
import { Loader2, TerminalSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TerminalInstance } from "@/features/projects/components/TerminalInstance"
import { useTerminalStore } from "@/stores/useTerminalStore"

interface WorkbenchTerminalTileProps {
  projectPath: string | null
}

export function WorkbenchTerminalTile({ projectPath }: WorkbenchTerminalTileProps) {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const addTerminal = useTerminalStore((state) => state.actions.addTerminal)
  const removeTerminal = useTerminalStore((state) => state.actions.removeTerminal)
  const terminalIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setTerminalId(null)
      return
    }

    let cancelled = false

    void (async () => {
      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
      })

      if (cancelled) {
        if (result.success && result.terminalId) {
          void window.electronAPI.terminal.kill({ terminalId: result.terminalId })
        }
        return
      }

      if (!result.success || !result.terminalId) {
        setError(result.error ?? "Failed to create a terminal")
        return
      }

      terminalIdRef.current = result.terminalId
      setTerminalId(result.terminalId)
      addTerminal({
        id: result.terminalId,
        profileId: "default",
        profileName: "Shell",
        title: "Shell",
        projectPath,
        kind: "shell",
        surface: "panel",
        status: "starting",
        hasOutput: false,
      })
    })()

    return () => {
      cancelled = true
      const activeTerminalId = terminalIdRef.current
      if (!activeTerminalId) return
      removeTerminal(activeTerminalId)
      void window.electronAPI.terminal.kill({ terminalId: activeTerminalId })
      terminalIdRef.current = null
    }
  }, [addTerminal, projectPath, removeTerminal])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Open or relink a local project folder to start a terminal here.
      </div>
    )
  }

  if (error) {
    return (
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
  }

  if (!terminalId) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing terminal…
      </div>
    )
  }

  return (
    <div className="h-full min-h-0">
      <TerminalInstance terminalId={terminalId} className="h-full" />
    </div>
  )
}
