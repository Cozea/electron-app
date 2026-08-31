import type { DesktopPreviewColorScheme } from "@cozea/contracts/t3/ipc"
import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
import { useBrowserFindUiStore } from "./browserFindUiStore"
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

function MoreIcon() {
  return <span className="text-base leading-none">⋮</span>
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
  const findVisible = useBrowserFindUiStore((store) => store.visibleByTabId[runtimeTabId] ?? false)
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

  const handleCapture = (record: boolean) => {
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
    if (record) {
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
  const supportsFind = entry.descriptor.kind === "browser"
  const toggleFind = () => useBrowserFindUiStore.getState().toggle(runtimeTabId)
  const togglePiP = () =>
    callTab(
      state?.pictureInPicture ? preview.pictureInPicture.close : preview.pictureInPicture.open,
    )
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-browser-preview-actions>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={pickActive || recording || state?.pictureInPicture ? "secondary" : "ghost"}
                size="icon-xs"
                className="relative"
                aria-label="Browser and preview menu"
              >
                <MoreIcon />
                {recording ? (
                  <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-destructive" />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Browser and preview controls</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-56">
          {supportsFind ? (
            <DropdownMenuCheckboxItem
              disabled={!available}
              checked={findVisible}
              onClick={toggleFind}
            >
              Find in page
              <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
          ) : null}
          <DropdownMenuCheckboxItem
            disabled={!available}
            checked={pickActive}
            onClick={handlePick}
          >
            {pickActive ? "Cancel annotation" : "Annotate preview"}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset disabled={!available}>
              {recording ? "Recording active" : "Capture and recording"}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-52">
              <DropdownMenuItem onClick={() => handleCapture(false)}>
                {recording ? "Stop recording" : "Capture screenshot"}
              </DropdownMenuItem>
              {!recording ? (
                <DropdownMenuItem onClick={() => handleCapture(true)}>
                  Start recording
                </DropdownMenuItem>
              ) : null}
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
                <DropdownMenuItem
                  onClick={() => void preview.revealArtifact(recordingArtifact.path)}
                >
                  Reveal last recording
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            disabled={!available}
            checked={state?.pictureInPicture ?? false}
            onClick={togglePiP}
          >
            {state?.pictureInPicture
              ? "Close separate preview window"
              : "Open separate preview window"}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            inset
            disabled={!available || !panelRect}
            onClick={toggleDeviceToolbar}
          >
            {viewport._tag === "fill" ? "Show device toolbar" : "Hide device toolbar"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset disabled={!available}>
              Appearance
            </DropdownMenuSubTrigger>
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset disabled={!available}>
              Zoom {Math.round((state?.zoomFactor ?? 1) * 100)}%
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40">
              <DropdownMenuItem onClick={() => callTab(preview.zoomIn)}>Zoom in</DropdownMenuItem>
              <DropdownMenuItem onClick={() => callTab(preview.zoomOut)}>Zoom out</DropdownMenuItem>
              <DropdownMenuItem onClick={() => callTab(preview.resetZoom)}>
                Actual size
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Advanced</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-44">
              <DropdownMenuItem
                disabled={!available}
                onClick={() => callTab(preview.hardReload)}
              >
                Hard reload
                <DropdownMenuShortcut>⌘⇧R</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!available}
                onClick={() => callTab(preview.openDevTools)}
              >
                Open DevTools
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void preview.clearCookies()}>
                Clear cookies
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void preview.clearCache()}>
                Clear cache
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
