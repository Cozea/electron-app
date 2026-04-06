import { useEffect, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import { Maximize2, Minimize2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface WorkbenchTileChromeProps {
  title: string
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  controls?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function WorkbenchTileChrome({
  title,
  panelApi,
  containerApi,
  controls,
  actions,
  children,
  className,
  contentClassName,
}: WorkbenchTileChromeProps) {
  const [isMaximized, setIsMaximized] = useState(() => panelApi.isMaximized())

  useEffect(() => {
    setIsMaximized(panelApi.isMaximized())

    const disposable = containerApi.onDidMaximizedGroupChange((event) => {
      if (event.group.id !== panelApi.group.id) return
      setIsMaximized(event.isMaximized)
    })

    const groupChangeDisposable = panelApi.onDidGroupChange(() => {
      setIsMaximized(panelApi.isMaximized())
    })

    return () => {
      disposable.dispose()
      groupChangeDisposable.dispose()
    }
  }, [containerApi, panelApi])

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-content-surface", className)}>
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-content-surface px-2 text-xs shadow-none"
        data-workbench-chrome="true"
      >
        <div className="min-w-0 flex-1">
          {controls ?? <span className="truncate text-xs text-foreground">{title}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (panelApi.isMaximized()) {
                panelApi.exitMaximized()
                setIsMaximized(false)
                return
              }
              panelApi.maximize()
              setIsMaximized(true)
            }}
            aria-label={isMaximized ? "Restore tile" : "Maximize tile"}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => panelApi.close()}
            aria-label={`Close ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1", contentClassName)}>
        {children}
      </div>
    </div>
  )
}
