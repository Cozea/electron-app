import { useEffect } from "react"
import { ExternalLink, Loader2, Play, RefreshCcw, Square, TerminalSquare } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDevServerManager } from "@/hooks/useDevServerManager"
import type { WorkbenchDevServerTile } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchDevServerTileProps {
  tile: WorkbenchDevServerTile
  projectPath: string | null
  onLinkedBrowserReady: (url: string) => void
  onOpenBrowser: (url: string) => void
}

function getStatusLabel(status: ReturnType<typeof useDevServerManager>["status"]): string {
  switch (status) {
    case "ready":
      return "Ready"
    case "starting":
      return "Starting"
    case "unhealthy":
      return "Unhealthy"
    case "error":
      return "Error"
    case "stopped":
      return "Stopped"
    case "idle":
    default:
      return "Idle"
  }
}

export function WorkbenchDevServerTile({
  tile,
  projectPath,
  onLinkedBrowserReady,
  onOpenBrowser,
}: WorkbenchDevServerTileProps) {
  const devServer = useDevServerManager({
    projectPath,
    autoStart: false,
  })

  useEffect(() => {
    if (!devServer.url || !tile.linkedBrowserTileId) return
    onLinkedBrowserReady(devServer.url)
  }, [devServer.url, onLinkedBrowserReady, tile.linkedBrowserTileId])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Open or relink a local project folder to manage a dev server here.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="px-2 py-0.5 text-[11px]">
            {getStatusLabel(devServer.status)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {devServer.url || "No active local URL yet"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {devServer.isRunning ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  void devServer.restart()
                }}
                aria-label="Restart dev server"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => {
                  void devServer.stop()
                }}
                aria-label="Stop dev server"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                void devServer.start()
              }}
              aria-label="Start dev server"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {devServer.status === "starting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <TerminalSquare className="h-3 w-3" />}
          <span>{devServer.error || "Run the project command here and open the local app in a browser tile when ready."}</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={!devServer.url}
          onClick={() => {
            if (!devServer.url) return
            onOpenBrowser(devServer.url)
          }}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          Open Browser
        </Button>
      </div>

      <div className="app-scrollbar flex-1 overflow-auto p-3">
        <pre className="min-h-full whitespace-pre-wrap border border-border/60 bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground">
          {devServer.output.length > 0
            ? devServer.output.join("")
            : "No server output yet.\n\nStart the dev server to stream logs here."}
        </pre>
      </div>
    </div>
  )
}
