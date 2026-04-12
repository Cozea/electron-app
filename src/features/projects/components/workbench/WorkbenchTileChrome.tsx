import { useEffect, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import { ArrowsPointingInIcon as Minimize2, ArrowsPointingOutIcon as Maximize2, XMarkIcon as X } from "@heroicons/react/24/outline"
import {
  ArchiveBoxIcon as PackageOpen,
  CommandLineIcon as SquareTerminal,
  GlobeAltIcon as Globe,
  SparklesIcon as Sparkles,
} from "@heroicons/react/24/solid"

import { Button } from "@/components/ui/button"
import {
  ClaudeAI,
  Gemini,
  OpenAI,
  OpenCodeIcon,
} from "@/features/projects/components/assistant/Icons"
import { cn } from "@/lib/utils"

interface WorkbenchTileChromeProps {
  title: string
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  chromeVariant?: "bar" | "pill"
  tileType?: "selection" | "assistantChat" | "terminal" | "browser" | "devServer"
  assistantProvider?: string | null
  controls?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

function resolveAssistantProviderIcon(provider: string | null | undefined) {
  switch (provider) {
    case "claudeAgent":
      return ClaudeAI
    case "gemini":
      return Gemini
    case "openCode":
      return OpenCodeIcon
    case "codex":
    default:
      return OpenAI
  }
}

function resolveTileIcon(
  tileType: WorkbenchTileChromeProps["tileType"],
  assistantProvider: string | null | undefined,
) {
  switch (tileType) {
    case "assistantChat":
      return resolveAssistantProviderIcon(assistantProvider)
    case "terminal":
      return SquareTerminal
    case "browser":
      return Globe
    case "selection":
      return Sparkles
    case "devServer":
      return PackageOpen
    default:
      return null
  }
}

export function WorkbenchTileChrome({
  title,
  panelApi,
  containerApi,
  chromeVariant = "bar",
  tileType,
  assistantProvider,
  controls,
  actions,
  children,
  className,
  contentClassName,
}: WorkbenchTileChromeProps) {
  const [isMaximized, setIsMaximized] = useState(() => panelApi.isMaximized())
  const TileIcon = resolveTileIcon(tileType, assistantProvider)

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
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 text-xs shadow-none",
          chromeVariant === "pill"
            ? "bg-transparent px-1.5 pt-0.5"
            : "border-b border-border/70 bg-content-surface px-2",
        )}
        data-workbench-chrome="true"
      >
        <div
          className={cn(
            "inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5",
            chromeVariant === "pill" ? "max-w-fit" : "max-w-[11rem]",
          )}
        >
          {TileIcon ? <TileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate text-xs text-foreground">{title}</span>
        </div>

        {controls ? (
          <div className="min-w-0 flex-1">
            {controls}
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            chromeVariant === "pill" && "rounded-full bg-secondary px-1",
          )}
        >
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-accent hover:text-foreground"
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
            className="h-7 w-7 hover:bg-accent hover:text-foreground"
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
