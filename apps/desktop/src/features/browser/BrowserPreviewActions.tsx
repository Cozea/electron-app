import type { DesktopPreviewColorScheme } from "@cozea/contracts/t3/ipc"
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc"
import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { appToast } from "@/lib/appToast"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"

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

  const handleOpenMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const rect = event.currentTarget.getBoundingClientRect()
    const position = {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    }

    const items: ContextMenuItem<string>[] = []

    if (supportsFind) {
      items.push({
        id: "find",
        label: "Find in page",
        type: "checkbox",
        checked: findVisible,
        enabled: available,
        accelerator: "CmdOrCtrl+F",
        icon: getNativeMenuIcon("search"),
      })
    }

    items.push({
      id: "annotate",
      label: pickActive ? "Cancel annotation" : "Annotate preview",
      type: "checkbox",
      checked: pickActive,
      enabled: available,
      icon: getNativeMenuIcon("rename"),
    })

    const captureSubmenu: ContextMenuItem<string>[] = [
      {
        id: recording ? "stop-recording" : "capture-screenshot",
        label: recording ? "Stop recording" : "Capture screenshot",
        icon: getNativeMenuIcon(recording ? "record" : "camera"),
      },
    ]
    if (!recording) {
      captureSubmenu.push({
        id: "start-recording",
        label: "Start recording",
        icon: getNativeMenuIcon("record"),
      })
    }
    if (screenshot || recordingArtifact) {
      captureSubmenu.push({ id: "sep-artifacts", type: "separator" })
    }
    if (screenshot) {
      captureSubmenu.push(
        { id: "reveal-screenshot", label: "Reveal last screenshot", icon: getNativeMenuIcon("open-folder") },
        { id: "copy-screenshot", label: "Copy last screenshot", icon: getNativeMenuIcon("copy") },
      )
    }
    if (recordingArtifact) {
      captureSubmenu.push({ id: "reveal-recording", label: "Reveal last recording", icon: getNativeMenuIcon("open-folder") })
    }

    items.push({
      id: "capture-and-recording",
      label: recording ? "Recording active" : "Capture and recording",
      enabled: available,
      icon: getNativeMenuIcon("camera"),
      submenu: captureSubmenu,
    })

    items.push({
      id: "pip",
      label: state?.pictureInPicture
        ? "Close separate preview window"
        : "Open separate preview window",
      type: "checkbox",
      checked: Boolean(state?.pictureInPicture),
      enabled: available,
      icon: getNativeMenuIcon("popout"),
    })

    items.push({ id: "sep-device", type: "separator" })

    items.push({
      id: "toggle-device-toolbar",
      label: viewport._tag === "fill" ? "Show device toolbar" : "Hide device toolbar",
      enabled: Boolean(available && panelRect),
      icon: getNativeMenuIcon("smartphone"),
    })

    items.push({
      id: "appearance",
      label: "Appearance",
      enabled: available,
      icon: getNativeMenuIcon("theme"),
      submenu: COLOR_SCHEMES.map((option) => ({
        id: `color:${option.value}`,
        label: option.label,
        type: "radio" as const,
        checked: (state?.colorScheme ?? "system") === option.value,
      })),
    })

    items.push({
      id: "toggle-mute",
      label: `Mute audio${state?.audible ? " · playing" : ""}`,
      type: "checkbox",
      checked: Boolean(state?.audioMuted),
      enabled: available,
      icon: getNativeMenuIcon(state?.audioMuted ? "volume-x" : "volume"),
    })

    items.push({
      id: "zoom",
      label: `Zoom ${Math.round((state?.zoomFactor ?? 1) * 100)}%`,
      enabled: available,
      icon: getNativeMenuIcon("search"),
      submenu: [
        { id: "zoom-in", label: "Zoom in", accelerator: "CmdOrCtrl+Plus" },
        { id: "zoom-out", label: "Zoom out", accelerator: "CmdOrCtrl+-" },
        { id: "zoom-reset", label: "Actual size", accelerator: "CmdOrCtrl+0" },
      ],
    })

    items.push({ id: "sep-advanced", type: "separator" })

    items.push({
      id: "advanced",
      label: "Advanced",
      icon: getNativeMenuIcon("tools"),
      submenu: [
        {
          id: "hard-reload",
          label: "Hard reload",
          enabled: available,
          accelerator: "CmdOrCtrl+Shift+R",
          icon: getNativeMenuIcon("restore"),
        },
        {
          id: "open-devtools",
          label: "Open DevTools",
          enabled: available,
          icon: getNativeMenuIcon("code"),
        },
        { id: "sep-advanced-storage", type: "separator" },
        { id: "clear-cookies", label: "Clear cookies", icon: getNativeMenuIcon("delete") },
        { id: "clear-cache", label: "Clear cache", icon: getNativeMenuIcon("delete") },
      ],
    })

    const action = await showDesktopContextMenu(items, position)
    if (!action) return

    switch (action) {
      case "find":
        toggleFind()
        break
      case "annotate":
        handlePick()
        break
      case "capture-screenshot":
        handleCapture(false)
        break
      case "start-recording":
        handleCapture(true)
        break
      case "stop-recording":
        handleCapture(false)
        break
      case "reveal-screenshot":
        if (screenshot) void preview.revealArtifact(screenshot.path)
        break
      case "copy-screenshot":
        if (screenshot) void preview.copyArtifactToClipboard(screenshot.path)
        break
      case "reveal-recording":
        if (recordingArtifact) void preview.revealArtifact(recordingArtifact.path)
        break
      case "pip":
        togglePiP()
        break
      case "toggle-device-toolbar":
        toggleDeviceToolbar()
        break
      case "color:system":
        callTab((tabId) => preview.setColorScheme(tabId, "system"))
        break
      case "color:light":
        callTab((tabId) => preview.setColorScheme(tabId, "light"))
        break
      case "color:dark":
        callTab((tabId) => preview.setColorScheme(tabId, "dark"))
        break
      case "toggle-mute":
        callTab((tabId) => preview.setAudioMuted(tabId, !(state?.audioMuted ?? false)))
        break
      case "zoom-in":
        callTab(preview.zoomIn)
        break
      case "zoom-out":
        callTab(preview.zoomOut)
        break
      case "zoom-reset":
        callTab(preview.resetZoom)
        break
      case "hard-reload":
        callTab(preview.hardReload)
        break
      case "open-devtools":
        callTab(preview.openDevTools)
        break
      case "clear-cookies":
        void preview.clearCookies()
        break
      case "clear-cache":
        void preview.clearCache()
        break
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-browser-preview-actions>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={pickActive || recording || state?.pictureInPicture ? "secondary" : "ghost"}
            size="icon-xs"
            className="relative"
            aria-label="Browser and preview menu"
            aria-haspopup="menu"
            onClick={handleOpenMenu}
          >
            <MoreIcon />
            {recording ? (
              <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-destructive" />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Browser and preview controls</TooltipContent>
      </Tooltip>
    </div>
  )
}
