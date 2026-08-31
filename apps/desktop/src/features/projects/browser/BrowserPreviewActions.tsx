import type { DesktopPreviewColorScheme } from "@cozea/contracts/t3/ipc"
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { useShallow } from "zustand/react/shallow"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { appToast } from "@/lib/appToast"

import { attachPreviewAnnotationToComposer } from "./previewAnnotationComposerRegistry"
import { commitBrowserViewportChange } from "./browserViewportActions"
import { useBrowserViewportStore } from "./browserViewportStore"
import { resolveResponsiveBrowserViewportSize } from "./browserViewportLayout"
import { useBrowserSurfaceStore } from "./browserSurfaceStore"
import { useBrowserSurfaceRegistry } from "./browserSurfaceRegistry"
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore"
import { useBrowserArtifactStore } from "./browserArtifactStore"
import { FILL_PREVIEW_VIEWPORT } from "./previewViewport"
import {
  startBrowserRecording,
  stopBrowserRecording,
  useBrowserRecordingStore,
} from "./browserRecording"

const COLOR_SCHEMES: ReadonlyArray<{
  readonly value: DesktopPreviewColorScheme
  readonly label: string
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function ActionIcon({ kind }: { readonly kind: "capture" | "picker" | "pip" | "more" }) {
  if (kind === "more") return <span className="text-base leading-none">⋮</span>
  if (kind === "capture") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    )
  }
  if (kind === "picker") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m4 3 7 17 2.4-6.6L20 11 4 3Z" />
        <path d="m14 14 5 5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="13" y="11" width="6" height="5" rx="1" />
    </svg>
  )
}

export function BrowserPreviewActionsForTile({ tileId }: { readonly tileId: string }) {
  const entries = useBrowserSurfaceRegistry(
    useShallow((state) => Object.values(state.byTabId).filter((entry) => entry.owners.size > 0)),
  )
  const descriptor = entries.find((entry) => entry.descriptor.tileId === tileId)?.descriptor ?? null
  return descriptor ? <BrowserPreviewActions runtimeTabId={descriptor.runtimeTabId} /> : null
}

export function BrowserPreviewActions({ runtimeTabId }: { readonly runtimeTabId: string }) {
  const preview = window.desktopBridge?.preview
  const entry = useBrowserSurfaceRegistry((state) => state.byTabId[runtimeTabId])
  const state = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId])
  const viewport =
    useBrowserViewportStore((store) => store.byTabId[runtimeTabId]) ?? FILL_PREVIEW_VIEWPORT
  const panelRect = useBrowserSurfaceStore((store) => store.byTabId[runtimeTabId]?.rect ?? null)
  const recording = useBrowserRecordingStore((store) => store.activeTabIds.has(runtimeTabId))
  const screenshot = useBrowserArtifactStore((store) => store.screenshotByTabId[runtimeTabId])
  const recordingArtifact = useBrowserArtifactStore((store) => store.recordingByTabId[runtimeTabId])
  const [pickActive, setPickActive] = useState(false)
  const pickActiveRef = useRef(false)
  const mountedRef = useRef(true)
  const available = Boolean(preview && state?.webContentsId)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pickActiveRef.current)
        void preview?.cancelPickElement(runtimeTabId).catch(() => undefined)
    }
  }, [preview, runtimeTabId])

  const callTab = (operation: (tabId: string) => Promise<void>) => {
    if (!available) return
    void operation(runtimeTabId).catch((error) =>
      appToast.error({
        title: "Preview action failed",
        description: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  const toggleDeviceToolbar = () => {
    if (!panelRect) return
    const next =
      viewport._tag === "fill"
        ? {
            _tag: "freeform" as const,
            ...resolveResponsiveBrowserViewportSize(panelRect, state?.zoomFactor ?? 1),
          }
        : ({ _tag: "fill" } as const)
    void commitBrowserViewportChange(runtimeTabId, next).catch((error) =>
      appToast.error({
        title: "Unable to resize browser viewport",
        description: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  const handleCapture = (event: MouseEvent<HTMLButtonElement>) => {
    if (!preview || !available) return
    if (recording) {
      void stopBrowserRecording(runtimeTabId).then(
        (artifact) => {
          if (!artifact) return
          useBrowserArtifactStore.getState().setRecording(artifact)
          appToast.success({ title: "Recording saved", description: artifact.path })
        },
        (error) =>
          appToast.error({
            title: "Unable to stop recording",
            description: error instanceof Error ? error.message : String(error),
          }),
      )
      return
    }
    if (event.shiftKey) {
      void startBrowserRecording(runtimeTabId).catch((error) =>
        appToast.error({
          title: "Unable to start recording",
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      return
    }
    void preview.captureScreenshot(runtimeTabId).then(
      (artifact) => {
        useBrowserArtifactStore.getState().setScreenshot(artifact)
        appToast.success({ title: "Screenshot saved", description: artifact.path })
      },
      (error) =>
        appToast.error({
          title: "Unable to capture screenshot",
          description: error instanceof Error ? error.message : String(error),
        }),
    )
  }

  const handlePick = useCallback(() => {
    if (!preview || !entry || !available) return
    if (pickActiveRef.current) {
      void preview.cancelPickElement(runtimeTabId).catch(() => undefined)
      return
    }
    const previouslyFocused = document.activeElement as HTMLElement | null
    pickActiveRef.current = true
    setPickActive(true)
    void preview
      .pickElement(runtimeTabId)
      .then(async (result) => {
        if (!result) return
        const attached = await attachPreviewAnnotationToComposer(
          entry.descriptor.workbenchSessionKey,
          result.annotation,
          result.submission,
        )
        if (!attached)
          appToast.warning({
            title: "No assistant composer is open",
            description: "Open an assistant tile in this workbench to attach the annotation.",
          })
      })
      .catch(() => undefined)
      .finally(() => {
        pickActiveRef.current = false
        if (mountedRef.current) setPickActive(false)
        if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
      })
  }, [available, entry, preview, runtimeTabId])

  if (!preview || !entry) return null
  const togglePiP = () =>
    callTab(
      state?.pictureInPicture ? preview.pictureInPicture.close : preview.pictureInPicture.open,
    )
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-browser-preview-actions>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={pickActive ? "secondary" : "ghost"}
            size="icon-xs"
            disabled={!available}
            aria-label={pickActive ? "Cancel annotation" : "Annotate preview"}
            aria-pressed={pickActive}
            onClick={handlePick}
          >
            <ActionIcon kind="picker" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {pickActive ? "Cancel annotation (Esc)" : "Annotate elements, regions, and drawings"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={recording ? "secondary" : "ghost"}
            size="icon-xs"
            disabled={!available}
            aria-label={recording ? "Stop recording" : "Capture screenshot"}
            className="relative"
            onClick={handleCapture}
          >
            <ActionIcon kind="capture" />
            {recording ? (
              <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-destructive" />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {recording ? "Stop recording" : "Screenshot · Shift-click to record"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={state?.pictureInPicture ? "secondary" : "ghost"}
            size="icon-xs"
            disabled={!available}
            aria-label={
              state?.pictureInPicture
                ? "Close separate preview window"
                : "Open separate preview window"
            }
            aria-pressed={state?.pictureInPicture}
            onClick={togglePiP}
          >
            <ActionIcon kind="pip" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {state?.pictureInPicture
            ? "Close separate preview window"
            : "Open separate preview window"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Preview menu">
                <ActionIcon kind="more" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More preview controls</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={!available} onClick={() => callTab(preview.hardReload)}>
            Hard reload
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!available} onClick={() => callTab(preview.openDevTools)}>
            Open DevTools
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!available || !panelRect} onClick={toggleDeviceToolbar}>
            {viewport._tag === "fill" ? "Show device toolbar" : "Hide device toolbar"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!available}>Appearance</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-32">
              <DropdownMenuRadioGroup value={state?.colorScheme ?? "system"}>
                {COLOR_SCHEMES.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    onClick={() => callTab((tabId) => preview.setColorScheme(tabId, option.value))}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            disabled={!available}
            checked={state?.audioMuted ?? false}
            onClick={() =>
              callTab((tabId) => preview.setAudioMuted(tabId, !(state?.audioMuted ?? false)))
            }
          >
            Mute audio{state?.audible ? " · playing" : ""}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Zoom {Math.round((state?.zoomFactor ?? 1) * 100)}%</DropdownMenuLabel>
          <DropdownMenuItem disabled={!available} onClick={() => callTab(preview.zoomIn)}>
            Zoom in
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!available} onClick={() => callTab(preview.zoomOut)}>
            Zoom out
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!available} onClick={() => callTab(preview.resetZoom)}>
            Actual size
          </DropdownMenuItem>
          {screenshot || recordingArtifact ? <DropdownMenuSeparator /> : null}
          {screenshot ? (
            <>
              <DropdownMenuItem onClick={() => void preview.revealArtifact(screenshot.path)}>
                Reveal last screenshot
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void preview.copyArtifactToClipboard(screenshot.path)}
              >
                Copy last screenshot
              </DropdownMenuItem>
            </>
          ) : null}
          {recordingArtifact ? (
            <DropdownMenuItem onClick={() => void preview.revealArtifact(recordingArtifact.path)}>
              Reveal last recording
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void preview.clearCookies()}>
            Clear cookies
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void preview.clearCache()}>Clear cache</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
