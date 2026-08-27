import * as React from "react"

import type { ElectronWindowContext } from "@shared/electronApiTypes"

const MAC_TOP_INSET_PX = 36
const MAC_COMPACT_LEFT_INSET_PX = 48
const MAC_WIDE_LEFT_INSET_PX = 74
const MAC_FULLSCREEN_LEFT_INSET_PX = 8
const MAC_TITLEBAR_LEADING_WIDTH_PX = 70
const MAC_FULLSCREEN_TITLEBAR_LEADING_WIDTH_PX = 4

type RendererPlatform = NodeJS.Platform | "unknown"

export interface WindowChromeState {
  platform: RendererPlatform
  windowContext: ElectronWindowContext
  isFullScreen: boolean
  isMac: boolean
  isWindows: boolean
  showMacWindowControls: boolean
  topInset: number
  compactLeftInset: number
  wideLeftInset: number
  titlebarLeadingSpace: number
}

let fullScreenSnapshot = false
let fullScreenListenerAttached = false
let fullScreenUnsubscribe: (() => void) | null = null
const fullScreenListeners = new Set<() => void>()

function emitFullScreenChange(nextValue: boolean) {
  const normalizedValue = Boolean(nextValue)
  if (fullScreenSnapshot === normalizedValue) return
  fullScreenSnapshot = normalizedValue
  fullScreenListeners.forEach((listener) => listener())
}

function ensureFullScreenSubscription() {
  if (typeof window === "undefined" || fullScreenListenerAttached) return

  fullScreenListenerAttached = true
  fullScreenUnsubscribe =
    window.electronAPI?.window?.onFullScreenChange?.((isFullScreen) => {
      emitFullScreenChange(isFullScreen)
    }) ?? null

  void window.electronAPI?.window?.isFullScreen?.()
    .then((isFullScreen) => {
      emitFullScreenChange(isFullScreen)
    })
    .catch(() => {
      emitFullScreenChange(false)
    })
}

function subscribeToFullScreen(callback: () => void) {
  fullScreenListeners.add(callback)
  ensureFullScreenSubscription()

  return () => {
    fullScreenListeners.delete(callback)

    if (fullScreenListeners.size > 0) return

    fullScreenUnsubscribe?.()
    fullScreenUnsubscribe = null
    fullScreenListenerAttached = false
  }
}

function getFullScreenSnapshot() {
  return fullScreenSnapshot
}

function getServerFullScreenSnapshot() {
  return false
}

function getRendererPlatform(): RendererPlatform {
  if (typeof window === "undefined") return "unknown"
  return (window.electronAPI?.platform ?? "unknown") as RendererPlatform
}

function getWindowContext(): ElectronWindowContext {
  if (typeof window === "undefined") return "main"
  return window.electronAPI?.windowContext ?? "main"
}

export function useWindowChrome(): WindowChromeState {
  const isFullScreen = React.useSyncExternalStore(
    subscribeToFullScreen,
    getFullScreenSnapshot,
    getServerFullScreenSnapshot
  )

  const platform = getRendererPlatform()
  const windowContext = getWindowContext()
  const isMac = platform === "darwin"
  const isWindows = platform === "win32"
  const showMacWindowControls = isMac && !isFullScreen

  return React.useMemo(
    () => ({
      platform,
      windowContext,
      isFullScreen,
      isMac,
      isWindows,
      showMacWindowControls,
      topInset: showMacWindowControls ? MAC_TOP_INSET_PX : 0,
      compactLeftInset: isMac
        ? showMacWindowControls
          ? MAC_COMPACT_LEFT_INSET_PX
          : MAC_FULLSCREEN_LEFT_INSET_PX
        : 0,
      wideLeftInset: isMac
        ? showMacWindowControls
          ? MAC_WIDE_LEFT_INSET_PX
          : MAC_FULLSCREEN_LEFT_INSET_PX
        : 0,
      titlebarLeadingSpace: isMac
        ? showMacWindowControls
          ? MAC_TITLEBAR_LEADING_WIDTH_PX
          : MAC_FULLSCREEN_TITLEBAR_LEADING_WIDTH_PX
        : 0,
    }),
    [isFullScreen, isMac, isWindows, platform, showMacWindowControls, windowContext]
  )
}
