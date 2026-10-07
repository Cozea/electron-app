import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { DockviewPanelApi } from "dockview-react"
import type { ProviderKind } from "@cozea/assistant-contracts"
import { SiOllama } from "react-icons/si"

import { AnchoredAppOverlayPortal } from "@/components/ui/app-overlay-portal"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { ProjectDevAppIcon } from "@/features/devapps/components/ProjectDevAppIcon"
import { PublishedDevAppIcon } from "@/features/devapps/components/PublishedDevAppIcon"
import {
  getDevAppForAssistantProvider,
  getDevAppForSurfaceTileType,
} from "@/features/devapps/registry"
import type { DevAppWorkbenchTileTarget } from "@/features/devapps/registry/types"
import {
  ClaudeAI,
  CursorIcon,
  Gemini,
  OpenAI,
  OpenCodeIcon,
} from "@/features/assistant/Icons"
import { useRegisterWorkbenchDockHeaderControls } from "@/features/workbench/workbenchDockHeaderControls"
import { useWorkbenchDockRuntime } from "@/features/workbench/WorkbenchDockRuntimeContext"
import { type RenderableWorkbenchTileType } from "@/lib/workbenchTileContract"
import {
  getWorkbenchTileDefinition,
} from "@/features/workbench/model/workbenchTileRegistry"
import { useElementPointerHover } from "@/hooks/useElementPointerHover"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { AddCircleIcon as __AddCircleHugeIcon, ArrowLeftRightIcon as __MessagesHugeIcon, ComputerTerminal01Icon as __ComputerTerminalHugeIcon, DeviceAccessIcon as __PhoneHugeIcon, Globe02Icon as __GlobeHugeIcon, ServerStack02Icon as __DevServerHugeIcon, ArrowUp01Icon as __ArrowUpHugeIcon, ArrowDown01Icon as __ArrowDownHugeIcon, ArrowLeft01Icon as __ArrowLeftHugeIcon, ArrowRight01Icon as __ArrowRightHugeIcon, BrainCircuitIcon as __BrainCircuitHugeIcon } from '@hugeicons/core-free-icons'

const DevServer = (props: any) => <HugeiconsIcon icon={__DevServerHugeIcon} {...props} />
const Messages = (props: any) => <HugeiconsIcon icon={__MessagesHugeIcon} {...props} />
const ComputerTerminal = (props: any) => <HugeiconsIcon icon={__ComputerTerminalHugeIcon} {...props} />
const Phone = (props: any) => <HugeiconsIcon icon={__PhoneHugeIcon} {...props} />
const Globe = (props: any) => <HugeiconsIcon icon={__GlobeHugeIcon} {...props} />
const AddCircle = (props: any) => <HugeiconsIcon icon={__AddCircleHugeIcon} {...props} />
const BrainCircuit = (props: any) => <HugeiconsIcon icon={__BrainCircuitHugeIcon} {...props} />
const WORKBENCH_OVERLAY_APP_ICON_CLASS = "size-6 shrink-0 overflow-hidden rounded-[5.3px]"

interface WorkbenchTileChromeProps {
  title: string
  panelApi: DockviewPanelApi
  /** Header controls and actions render in the dockview group header, not here. */
  controls?: ReactNode
  actions?: ReactNode
  tileType?: RenderableWorkbenchTileType
  devAppId?: string | null
  logoDataUrl?: string | null
  assistantProvider?: string | null
  children: ReactNode
  className?: string
  contentClassName?: string
}

type SplitDirection = "top" | "bottom" | "left" | "right"

const SPLIT_DIRECTION_BY_KEY: Partial<Record<string, SplitDirection>> = {
  ArrowUp: "top",
  ArrowDown: "bottom",
  ArrowLeft: "left",
  ArrowRight: "right",
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
  if (!tileType) return null
  const source = getWorkbenchTileDefinition(tileType).manifestSource
  if (source === "assistant") {
    return getDevAppForAssistantProvider(
      typeof assistantProvider === "string" ? (assistantProvider as ProviderKind) : null,
    )
  }

  if (source === "surface") {
    return getDevAppForSurfaceTileType(tileType as DevAppWorkbenchTileTarget)
  }

  return null
}

function resolveTileFallbackIcon(
  tileType: WorkbenchTileChromeProps["tileType"],
  assistantProvider: string | null | undefined,
) {
  const fallback = tileType ? getWorkbenchTileDefinition(tileType).fallbackIcon : null
  switch (fallback) {
    case "messages":
      return resolveAssistantProviderIcon(assistantProvider) ?? Messages
    case "terminal":
      return ComputerTerminal
    case "browser":
      return Globe
    case "add":
      return AddCircle
    case "devServer":
      return DevServer
    case "llama":
      return SiOllama
    case "memory":
      return BrainCircuit
    case "published":
      return Globe
    case "mobileSimulator":
      return Phone
    default:
      return null
  }
}

interface WorkbenchTileGlyphProps {
  tileType: WorkbenchTileChromeProps["tileType"]
  assistantProvider?: string | null
  devAppId?: string | null
  logoDataUrl?: string | null
  title: string
  appWrapperClassName: string
  fallbackClassName: string
}

function WorkbenchTileGlyph({
  tileType,
  assistantProvider,
  devAppId,
  logoDataUrl,
  title,
  appWrapperClassName,
  fallbackClassName,
}: WorkbenchTileGlyphProps) {
  if (tileType === "orgDevApp" || tileType === "devAppPreview") {
    return (
      <span className={appWrapperClassName}>
        <PublishedDevAppIcon name={title} logoDataUrl={logoDataUrl} />
      </span>
    )
  }

  if (tileType === "devServer" && devAppId) {
    return (
      <span className={appWrapperClassName}>
        <ProjectDevAppIcon name={title} />
      </span>
    )
  }

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

const TILE_CHROME_SELECTOR = "[data-workbench-tile-chrome]"

/**
 * Which tile a split gesture acts on: the tile holding keyboard focus, or,
 * when focus sits outside every tile, the one under the pointer.
 *
 * Focus can be in the tile body or in its dock group's header (e.g. the
 * address bar). The two live in different DOM subtrees: dockview renders
 * always-mounted bodies in an overlay layer, not inside `.dv-groupview`.
 */
function isSplitGestureTarget(
  tileElement: HTMLElement,
  panelApi: DockviewPanelApi,
  isHovered: boolean,
): boolean {
  const focused = document.activeElement
  if (!(focused instanceof Element)) return isHovered

  const focusedTile = focused.closest(TILE_CHROME_SELECTOR)
  if (focusedTile) return focusedTile === tileElement

  const focusedGroup = focused.closest(".dv-groupview")
  if (focusedGroup) return focusedGroup === panelApi.group.element && panelApi.isVisible

  return isHovered
}

export function WorkbenchTileChrome({
  title,
  panelApi,
  controls,
  actions,
  tileType,
  devAppId,
  logoDataUrl,
  assistantProvider,
  children,
  className,
  contentClassName,
}: WorkbenchTileChromeProps) {
  const [splitOverlayActive, setSplitOverlayActive] = useState(false)
  const [splitDirection, setSplitDirection] = useState<SplitDirection | null>(null)
  const [tileElement, setTileElement] = useState<HTMLDivElement | null>(null)

  const runtime = useWorkbenchDockRuntime()
  const tileHover = useElementPointerHover<HTMLDivElement>()
  const isHovered = tileHover.isHovered
  const splitStateRef = useRef({ active: false, direction: null as SplitDirection | null })
  const setTileRef = useCallback(
    (node: HTMLDivElement | null) => {
      tileHover.ref(node)
      setTileElement(node)
    },
    [tileHover.ref],
  )

  useRegisterWorkbenchDockHeaderControls(panelApi.id, { controls, actions })

  // Hold Cmd+Option and press an arrow to pick a split side; releasing the
  // modifiers commits it and Escape cancels. Cmd+Option+Arrow is not a macOS text-editing binding
  // and terminals never receive Cmd keys, so it also works from the composer,
  // address bar or terminal. Keys typed inside a web page (Browser, Dev Server,
  // DevApp guests) stay in that page and never reach this listener.
  const isHoveredRef = useRef(isHovered)
  isHoveredRef.current = isHovered

  useEffect(() => {
    if (!tileElement) return

    const resetSplitState = () => {
      splitStateRef.current = { active: false, direction: null }
      setSplitOverlayActive(false)
      setSplitDirection(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && splitStateRef.current.active) {
        e.preventDefault()
        e.stopPropagation()
        resetSplitState()
        return
      }
      if (!e.metaKey || !e.altKey || e.shiftKey || e.ctrlKey) return
      const dir = SPLIT_DIRECTION_BY_KEY[e.key]
      if (!dir || !isSplitGestureTarget(tileElement, panelApi, isHoveredRef.current)) return

      e.preventDefault()
      e.stopPropagation()
      if (!splitStateRef.current.active) {
        splitStateRef.current.active = true
        setSplitOverlayActive(true)
      }
      if (dir !== splitStateRef.current.direction) {
        splitStateRef.current.direction = dir
        setSplitDirection(dir)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!splitStateRef.current.active || (e.metaKey && e.altKey)) return
      const dir = splitStateRef.current.direction
      resetSplitState()
      if (dir) runtime.onSplitTile(panelApi.id, dir)
    }

    // Losing window focus mid-gesture (Cmd+Tab away) never delivers the keyup.
    const handleBlur = () => {
      if (splitStateRef.current.active) resetSplitState()
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true })
    window.addEventListener("keyup", handleKeyUp, { capture: true })
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true })
      window.removeEventListener("keyup", handleKeyUp, { capture: true })
      window.removeEventListener("blur", handleBlur)
      if (splitStateRef.current.active) resetSplitState()
    }
  }, [tileElement, panelApi, runtime])

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-transparent relative", className)}
      data-workbench-tile-chrome=""
      data-workbench-tile-type={tileType}
      ref={setTileRef}
      onPointerEnter={tileHover.onPointerEnter}
      onPointerLeave={tileHover.onPointerLeave}
      onPointerMove={tileHover.onPointerMove}
    >
      <div
        className={cn("min-h-0 flex-1", contentClassName)}
        data-workbench-pane-content="true"
      >
        {children}
      </div>

      {splitOverlayActive ? (
        <AnchoredAppOverlayPortal
          anchor={tileElement}
          inset={1}
          className="flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none overflow-hidden"
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
                devAppId={devAppId}
                logoDataUrl={logoDataUrl}
                title={title}
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
        </AnchoredAppOverlayPortal>
      ) : null}
    </div>
  )
}