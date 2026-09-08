import { recordInteractionCounter } from "@/lib/performance/interactionCounters"

export interface BrowserSurfaceRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BrowserSurfaceContentPresentation {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly scrollLeft: number
  readonly scrollTop: number
}

export interface BrowserSurfaceGeometry {
  rect: BrowserSurfaceRect | null
  content: BrowserSurfaceContentPresentation | null
}

interface TabGeometryState {
  rect: BrowserSurfaceRect | null
  content: BrowserSurfaceContentPresentation | null
  owner: symbol | null
  readonly geometryListeners: Set<() => void>
  readonly rectListeners: Set<() => void>
  readonly contentListeners: Set<() => void>
}

const geometryByTabId = new Map<string, TabGeometryState>()

export function rectEquals(
  left: BrowserSurfaceRect | null | undefined,
  right: BrowserSurfaceRect | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function contentEquals(
  left: BrowserSurfaceContentPresentation | null | undefined,
  right: BrowserSurfaceContentPresentation | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.scale === right.scale &&
    left.scrollLeft === right.scrollLeft &&
    left.scrollTop === right.scrollTop
  )
}

function getOrCreateTabState(tabId: string): TabGeometryState {
  let state = geometryByTabId.get(tabId)
  if (!state) {
    state = {
      rect: null,
      content: null,
      owner: null,
      geometryListeners: new Set(),
      rectListeners: new Set(),
      contentListeners: new Set(),
    }
    geometryByTabId.set(tabId, state)
  }
  return state
}

export function registerBrowserSurfaceGeometryOwner(
  tabId: string,
  owner: symbol,
): void {
  const state = getOrCreateTabState(tabId)
  state.owner = owner
}

export function clearBrowserSurfaceGeometryOwner(
  tabId: string,
  owner: symbol,
): void {
  const state = geometryByTabId.get(tabId)
  if (!state || state.owner !== owner) return
  state.owner = null
  if (state.rect !== null) {
    state.rect = null
    notifyRect(state)
  }
}

export function getBrowserSurfaceRect(tabId: string): BrowserSurfaceRect | null {
  return geometryByTabId.get(tabId)?.rect ?? null
}

export function getBrowserSurfaceContent(
  tabId: string,
): BrowserSurfaceContentPresentation | null {
  return geometryByTabId.get(tabId)?.content ?? null
}

export function setBrowserSurfaceRect(
  tabId: string,
  owner: symbol,
  rect: BrowserSurfaceRect | null,
): boolean {
  recordInteractionCounter("browserGeometryPublishes")
  const state = getOrCreateTabState(tabId)
  if (state.owner !== owner) {
    return false
  }
  if (rectEquals(state.rect, rect)) {
    return true
  }
  state.rect = rect
  notifyRect(state)
  return true
}

export function setBrowserSurfaceContent(
  tabId: string,
  content: BrowserSurfaceContentPresentation | null,
): void {
  const state = getOrCreateTabState(tabId)
  if (contentEquals(state.content, content)) {
    return
  }
  state.content = content
  notifyContent(state)
}

function notifyRect(state: TabGeometryState): void {
  for (const listener of state.rectListeners) {
    try {
      listener()
    } catch (error) {
      console.error("[browserSurfaceGeometryRuntime] Error in rect listener:", error)
    }
  }
  for (const listener of state.geometryListeners) {
    try {
      listener()
    } catch (error) {
      console.error("[browserSurfaceGeometryRuntime] Error in geometry listener:", error)
    }
  }
}

function notifyContent(state: TabGeometryState): void {
  for (const listener of state.contentListeners) {
    try {
      listener()
    } catch (error) {
      console.error("[browserSurfaceGeometryRuntime] Error in content listener:", error)
    }
  }
  for (const listener of state.geometryListeners) {
    try {
      listener()
    } catch (error) {
      console.error("[browserSurfaceGeometryRuntime] Error in geometry listener:", error)
    }
  }
}

export function subscribeBrowserSurfaceGeometry(
  tabId: string,
  listener: () => void,
): () => void {
  const state = getOrCreateTabState(tabId)
  state.geometryListeners.add(listener)
  return () => {
    state.geometryListeners.delete(listener)
  }
}

export function subscribeBrowserSurfaceRect(
  tabId: string,
  listener: () => void,
): () => void {
  const state = getOrCreateTabState(tabId)
  state.rectListeners.add(listener)
  return () => {
    state.rectListeners.delete(listener)
  }
}

export function subscribeBrowserSurfaceContent(
  tabId: string,
  listener: () => void,
): () => void {
  const state = getOrCreateTabState(tabId)
  state.contentListeners.add(listener)
  return () => {
    state.contentListeners.delete(listener)
  }
}

export function _resetBrowserSurfaceGeometryRuntimeForTesting(): void {
  geometryByTabId.clear()
}
