import { useEffect, useRef, useState, type ReactNode } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import type { ContextMenuItem, ProviderKind } from "@cozea/assistant-contracts"

import { Button } from "@/components/ui/button"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import {
  getDevAppForAssistantProvider,
  getDevAppForSurfaceTileType,
} from "@/features/devapps/registry"
import {
  ClaudeAI,
  CursorIcon,
  Gemini,
  OpenAI,
  OpenCodeIcon,
} from "@/features/projects/components/assistant/Icons"
import { useWorkbenchDockRuntime } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { AddCircleIcon as __AddCircleHugeIcon, ArrowLeftRightIcon as __MessagesHugeIcon, Cancel01Icon as __XHugeIcon, ComputerTerminal01Icon as __ComputerTerminalHugeIcon, DeviceAccessIcon as __PhoneHugeIcon, Globe02Icon as __GlobeHugeIcon, ServerStack02Icon as __DevServerHugeIcon, Layout04Icon as __Layout04HugeIcon, ArrowUp01Icon as __ArrowUpHugeIcon, ArrowDown01Icon as __ArrowDownHugeIcon, ArrowLeft01Icon as __ArrowLeftHugeIcon, ArrowRight01Icon as __ArrowRightHugeIcon } from '@hugeicons/core-free-icons'

const DevServer = (props: any) => <HugeiconsIcon icon={__DevServerHugeIcon} {...props} />
const Messages = (props: any) => <HugeiconsIcon icon={__MessagesHugeIcon} {...props} />
const ComputerTerminal = (props: any) => <HugeiconsIcon icon={__ComputerTerminalHugeIcon} {...props} />
const Phone = (props: any) => <HugeiconsIcon icon={__PhoneHugeIcon} {...props} />
const Globe = (props: any) => <HugeiconsIcon icon={__GlobeHugeIcon} {...props} />
const AddCircle = (props: any) => <HugeiconsIcon icon={__AddCircleHugeIcon} {...props} />
const WORKBENCH_PILL_APP_ICON_CLASS = "size-5 shrink-0 overflow-hidden rounded-[5px]"
const WORKBENCH_OVERLAY_APP_ICON_CLASS = "size-6 shrink-0 overflow-hidden rounded-md"

interface WorkbenchTileChromeProps {
  title: string
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  chromeVariant?: "bar" | "pill"
  hideTitlePill?: boolean
  hideWindowActions?: boolean
  tileType?: "selection" | "assistantChat" | "terminal" | "browser" | "devServer" | "mobileSimulator"
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
    case "cursor":
      return CursorIcon
    case "gemini":
      return Gemini
    case "opencode":
      return OpenCodeIcon
    case "codex":
      return OpenAI
    default:
      return null
  }
}

function resolveTileDevApp(
  tileType: WorkbenchTileChromeProps["tileType"],
  assistantProvider: string | null | undefined,
) {
  if (tileType === "assistantChat") {
    return getDevAppForAssistantProvider(
      typeof assistantProvider === "string" ? (assistantProvider as ProviderKind) : null,
    )
  }

  if (
    tileType === "browser" ||
    tileType === "devServer" ||
    tileType === "mobileSimulator" ||
    tileType === "terminal"
  ) {
    return getDevAppForSurfaceTileType(tileType)
  }

  return null
}

function resolveAssistantProviderIconClass(provider: string | null | undefined) {
  switch (provider) {
    case "claudeAgent":
      return "text-[#d97757]"
    case "cursor":
      return "text-zinc-600"
    case "codex":
      return "text-foreground"
    case "gemini":
    case "opencode":
      return ""
    default:
      return "text-muted-foreground"
  }
}

function resolveTileFallbackIcon(
  tileType: WorkbenchTileChromeProps["tileType"],
  assistantProvider: string | null | undefined,
) {
  switch (tileType) {
    case "assistantChat":
      return resolveAssistantProviderIcon(assistantProvider) ?? Messages
    case "terminal":
      return ComputerTerminal
    case "browser":
      return Globe
    case "selection":
      return AddCircle
    case "devServer":
      return DevServer
    case "mobileSimulator":
      return Phone
    default:
      return null
  }
}

interface WorkbenchTileGlyphProps {
  tileType: WorkbenchTileChromeProps["tileType"]
  assistantProvider?: string | null
  appWrapperClassName: string
  fallbackClassName: string
}

function WorkbenchTileGlyph({
  tileType,
  assistantProvider,
  appWrapperClassName,
  fallbackClassName,
}: WorkbenchTileGlyphProps) {
  const devApp = resolveTileDevApp(tileType, assistantProvider)

  if (devApp) {
    return (
      <span className={appWrapperClassName}>
        <DevAppIcon app={devApp} />
      </span>
    )
  }

  const TileIcon = resolveTileFallbackIcon(tileType, assistantProvider)
  return TileIcon ? <TileIcon className={fallbackClassName} /> : null
}

export function WorkbenchTileChrome({
  title,
  panelApi,
  containerApi,
  chromeVariant = "bar",
  hideTitlePill = false,
  hideWindowActions = false,
  tileType,
  assistantProvider,
  controls,
  actions,
  children,
  className,
  contentClassName,
}: WorkbenchTileChromeProps) {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(() => panelApi.isMaximized())
  const [isHovered, setIsHovered] = useState(false)
  const [splitOverlayActive, setSplitOverlayActive] = useState(false)
  const [splitDirection, setSplitDirection] = useState<"top" | "bottom" | "left" | "right" | null>(null)
  
  const runtime = useWorkbenchDockRuntime()
  const splitStateRef = useRef({ active: false, direction: null as "top" | "bottom" | "left" | "right" | null })

  const tileFallbackIconClassName = cn(
    "h-5 w-5 shrink-0",
    tileType === "assistantChat"
      ? resolveAssistantProviderIconClass(assistantProvider)
      : "text-muted-foreground",
  )
  const pillControlHoverClasses =
    "text-muted-foreground hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // For DOM focus, we only want to act if this tile is hovered
      if (!isHovered) return

      if (e.altKey && e.shiftKey) {
        if (!splitStateRef.current.active) {
          splitStateRef.current.active = true
          setSplitOverlayActive(true)
        }
        let dir = splitStateRef.current.direction
        if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); dir = "top" }
        if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); dir = "bottom" }
        if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); dir = "left" }
        if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); dir = "right" }
        
        if (dir !== splitStateRef.current.direction) {
          splitStateRef.current.direction = dir
          setSplitDirection(dir)
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) {
        if (splitStateRef.current.active) {
          const dir = splitStateRef.current.direction
          if (dir) {
            runtime.onSplitTile(panelApi.id, dir)
          }
        }
        splitStateRef.current = { active: false, direction: null }
        setSplitOverlayActive(false)
        setSplitDirection(null)
      }
    }

    const handleSplitControlEvent = (e: Event) => {
      const command = (e as CustomEvent).detail
      
      // Removed the early return so the focused browser can trigger splits
      // for WHATEVER tile is currently being hovered over, not just itself.

      if (!isHovered) return

      if (command.type === 'split-control-activate') {
        if (!splitStateRef.current.active) {
          splitStateRef.current.active = true
          setSplitOverlayActive(true)
        }
      } else if (command.type === 'split-control-deactivate') {
        if (splitStateRef.current.active) {
          const dir = splitStateRef.current.direction
          if (dir) {
            runtime.onSplitTile(panelApi.id, dir)
          }
        }
        splitStateRef.current = { active: false, direction: null }
        setSplitOverlayActive(false)
        setSplitDirection(null)
      } else if (command.type === 'split-control-key') {
        let dir = splitStateRef.current.direction
        if (command.key === "ArrowUp") { dir = "top" }
        if (command.key === "ArrowDown") { dir = "bottom" }
        if (command.key === "ArrowLeft") { dir = "left" }
        if (command.key === "ArrowRight") { dir = "right" }
        
        if (dir !== splitStateRef.current.direction) {
          splitStateRef.current.direction = dir
          setSplitDirection(dir)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true })
    window.addEventListener("keyup", handleKeyUp, { capture: true })
    window.addEventListener("cozea:split-control", handleSplitControlEvent)

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true })
      window.removeEventListener("keyup", handleKeyUp, { capture: true })
      window.removeEventListener("cozea:split-control", handleSplitControlEvent)
      
      // Cleanup if component unmounts while active
      if (splitStateRef.current.active) {
        splitStateRef.current = { active: false, direction: null }
        setSplitOverlayActive(false)
        setSplitDirection(null)
      }
    }
  }, [isHovered, panelApi.id, runtime])

  return (
    <div 
      className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-content-surface relative", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 text-xs shadow-none",
          chromeVariant === "pill"
            ? "bg-transparent px-1.5 pt-0.5"
            : "border-b border-border/60 bg-content-surface px-2",
        )}
        data-workbench-chrome="true"
      >
        {!hideTitlePill ? (
          <div
            className={cn(
              "inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5",
              chromeVariant === "pill" ? "max-w-[60%]" : "max-w-[11rem]",
            )}
          >
            <WorkbenchTileGlyph
              tileType={tileType}
              assistantProvider={assistantProvider}
              appWrapperClassName={WORKBENCH_PILL_APP_ICON_CLASS}
              fallbackClassName={tileFallbackIconClassName}
            />
            <span className="truncate text-xs text-foreground">{title}</span>
          </div>
        ) : null}

        {controls ? (
          <div className="min-w-0 flex-1">
            {controls}
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        {!hideWindowActions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 transition-colors",
              chromeVariant === "pill" &&
                "rounded-md bg-secondary px-1 shadow-none ring-0",
            )}
          >
            {actions}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-md border-0 shadow-none transition-colors",
                chromeVariant === "pill"
                  ? pillControlHoverClasses
                  : "hover:bg-accent",
              )}
              onClick={async (event) => {
                event.preventDefault()
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                const position = {
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.bottom),
                }

                const items: ContextMenuItem<"maximize" | "restore" | "splitRight" | "splitLeft" | "splitDown" | "splitUp">[] = [
                  {
                    id: isMaximized ? "restore" : "maximize",
                    label: isMaximized ? t('workbench.layout.restore') : t('workbench.layout.maximize'),
                  },
                  { type: "separator", id: "sep1" as any },
                  {
                    id: "splitRight",
                    label: t('workbench.layout.splitRight'),
                  },
                  {
                    id: "splitLeft",
                    label: t('workbench.layout.splitLeft'),
                  },
                  { type: "separator", id: "sep2" as any },
                  {
                    id: "splitDown",
                    label: t('workbench.layout.splitDown'),
                  },
                  {
                    id: "splitUp",
                    label: t('workbench.layout.splitUp'),
                  },
                ]

                const action = await showDesktopContextMenu(items, position)
                if (!action) return

                switch (action) {
                  case "maximize":
                    panelApi.maximize()
                    setIsMaximized(true)
                    break
                  case "restore":
                    panelApi.exitMaximized()
                    setIsMaximized(false)
                    break
                  case "splitRight":
                    runtime.onSplitTile(panelApi.id, "right")
                    break
                  case "splitLeft":
                    runtime.onSplitTile(panelApi.id, "left")
                    break
                  case "splitDown":
                    runtime.onSplitTile(panelApi.id, "bottom")
                    break
                  case "splitUp":
                    runtime.onSplitTile(panelApi.id, "top")
                    break
                }
              }}
              aria-label={t('workbench.layout.optionsLabel')}
            >
              <HugeiconsIcon icon={__Layout04HugeIcon} className="h-3.5 w-3.5" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-md border-0 shadow-none transition-colors",
                chromeVariant === "pill"
                  ? pillControlHoverClasses
                  : "hover:bg-accent",
              )}
              onClick={() => panelApi.close()}
              aria-label={t('workbench.layout.closeLabel').replace('{title}', title)}
            >
              <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      <div className={cn("min-h-0 flex-1", contentClassName)}>
        {children}
      </div>

      {splitOverlayActive ? (
        <div
          className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[100] flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none rounded-[inherit]"
          data-workbench-browser-overlay="true"
          data-workbench-browser-overlay-reason="Split controls"
        >
          <div className="grid grid-cols-3 grid-rows-3 gap-2 p-4 pointer-events-auto">
            <div
              className={cn("col-start-2 row-start-1 flex h-12 w-12 items-center justify-center rounded-xl border-2 transition-colors cursor-pointer", splitDirection === "top" ? "border-primary bg-primary/20 text-primary" : "border-border bg-background/50 text-muted-foreground")}
              onMouseEnter={() => { splitStateRef.current.direction = "top"; setSplitDirection("top") }}
              onClick={() => {
                runtime.onSplitTile(panelApi.id, "top")
                splitStateRef.current = { active: false, direction: null }
                setSplitOverlayActive(false)
                setSplitDirection(null)
              }}
            >
              <HugeiconsIcon icon={__ArrowUpHugeIcon} className="h-6 w-6" />
            </div>
            <div
              className={cn("col-start-1 row-start-2 flex h-12 w-12 items-center justify-center rounded-xl border-2 transition-colors cursor-pointer", splitDirection === "left" ? "border-primary bg-primary/20 text-primary" : "border-border bg-background/50 text-muted-foreground")}
              onMouseEnter={() => { splitStateRef.current.direction = "left"; setSplitDirection("left") }}
              onClick={() => {
                runtime.onSplitTile(panelApi.id, "left")
                splitStateRef.current = { active: false, direction: null }
                setSplitOverlayActive(false)
                setSplitDirection(null)
              }}
            >
              <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="h-6 w-6" />
            </div>
            <div className="col-start-2 row-start-2 flex h-12 w-12 items-center justify-center rounded-xl border-2 border-primary/50 bg-primary/10 text-primary">
              <WorkbenchTileGlyph
                tileType={tileType}
                assistantProvider={assistantProvider}
                appWrapperClassName={WORKBENCH_OVERLAY_APP_ICON_CLASS}
                fallbackClassName="h-6 w-6 shrink-0"
              />
            </div>
            <div
              className={cn("col-start-3 row-start-2 flex h-12 w-12 items-center justify-center rounded-xl border-2 transition-colors cursor-pointer", splitDirection === "right" ? "border-primary bg-primary/20 text-primary" : "border-border bg-background/50 text-muted-foreground")}
              onMouseEnter={() => { splitStateRef.current.direction = "right"; setSplitDirection("right") }}
              onClick={() => {
                runtime.onSplitTile(panelApi.id, "right")
                splitStateRef.current = { active: false, direction: null }
                setSplitOverlayActive(false)
                setSplitDirection(null)
              }}
            >
              <HugeiconsIcon icon={__ArrowRightHugeIcon} className="h-6 w-6" />
            </div>
            <div
              className={cn("col-start-2 row-start-3 flex h-12 w-12 items-center justify-center rounded-xl border-2 transition-colors cursor-pointer", splitDirection === "bottom" ? "border-primary bg-primary/20 text-primary" : "border-border bg-background/50 text-muted-foreground")}
              onMouseEnter={() => { splitStateRef.current.direction = "bottom"; setSplitDirection("bottom") }}
              onClick={() => {
                runtime.onSplitTile(panelApi.id, "bottom")
                splitStateRef.current = { active: false, direction: null }
                setSplitOverlayActive(false)
                setSplitDirection(null)
              }}
            >
              <HugeiconsIcon icon={__ArrowDownHugeIcon} className="h-6 w-6" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
