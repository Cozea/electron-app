import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Elements that force an overlapping native surface to hide itself.
 *
 * Tooltips are deliberately NOT marked, here or in the tooltip primitives.
 * Occlusion is all-or-nothing for the remaining native surfaces, such as the
 * iOS simulator. Marking a hover hint would strobe the whole tile on every
 * pass across a toolbar, so a tooltip lost behind a native surface is the
 * cheaper failure. The same reasoning drives the `tooltipStyle` opt-outs in
 * the popover and anchored-toast primitives.
 */
export const NATIVE_SURFACE_OVERLAY_SELECTOR = [
  '[data-native-surface-overlay="true"]',
  // dockview renders its own popups (tab context menu, tabs-overflow list,
  // tab-group chip menu) into `.dv-popover-anchor`, and floating groups into
  // `.dv-resize-container`. Neither carries our marker, so without these a
  // native surface paints straight over them and the popup is unreachable.
  '.dv-popover-anchor > *',
  '.dv-resize-container',
].join(', ')

const DEFAULT_OVERLAY_MARGIN = 8

export interface NativeSurfaceRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface NativeSurfaceOcclusionState {
  occluded: boolean
  reason: string | null
  overlayRect: NativeSurfaceRect | null
}

interface NativeSurfaceRegistration {
  id: number
  element: HTMLElement
  overlaySelector: string
  overlayMargin: number
  callback: (state: NativeSurfaceOcclusionState) => void
  lastState: NativeSurfaceOcclusionState
}

interface RegisterNativeSurfaceOptions {
  overlaySelector?: string
  overlayMargin?: number
}

interface UseNativeSurfaceOcclusionOptions extends RegisterNativeSurfaceOptions {
  enabled?: boolean
  onStateChange?: (state: NativeSurfaceOcclusionState) => void
}

const UNOCCLUDED_STATE: NativeSurfaceOcclusionState = {
  occluded: false,
  reason: null,
  overlayRect: null,
}

const registrations = new Map<number, NativeSurfaceRegistration>()
const observedOverlays = new Set<Element>()
let nextRegistrationId = 1
let animationFrame = 0
let mutationObserver: MutationObserver | null = null
let surfaceResizeObserver: ResizeObserver | null = null
let overlayResizeObserver: ResizeObserver | null = null
let preflightOcclusionState: NativeSurfaceOcclusionState | null = null
let preflightTimer = 0

function isBrowserRuntimeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function isElementRectVisible(rect: DOMRect): boolean {
  return rect.width > 0.5 && rect.height > 0.5
}

function toNativeSurfaceRect(rect: DOMRect): NativeSurfaceRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function expandRect(rect: DOMRect, margin: number): NativeSurfaceRect {
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : DEFAULT_OVERLAY_MARGIN
  return {
    left: rect.left - safeMargin,
    top: rect.top - safeMargin,
    right: rect.right + safeMargin,
    bottom: rect.bottom + safeMargin,
    width: rect.width + safeMargin * 2,
    height: rect.height + safeMargin * 2,
  }
}

function isRectOverlapping(a: NativeSurfaceRect, b: NativeSurfaceRect): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
}

function getOverlayReason(element: HTMLElement): string | null {
  return (
    element.dataset.nativeSurfaceOverlayReason?.trim() ||
    element.dataset.slot?.trim() ||
    null
  )
}

function isOverlayCandidateVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.hidden) return false

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }

  return isElementRectVisible(element.getBoundingClientRect())
}

function statesEqual(a: NativeSurfaceOcclusionState, b: NativeSurfaceOcclusionState): boolean {
  if (a.occluded !== b.occluded || a.reason !== b.reason) return false
  // Consumers only need to know when a native surface becomes occluded/unoccluded.
  // Ignoring rect-only drift prevents popover animations from re-rendering every tile.
  return true
}

function readOcclusionState(registration: NativeSurfaceRegistration): NativeSurfaceOcclusionState {
  const surfaceRect = registration.element.getBoundingClientRect()
  if (!isElementRectVisible(surfaceRect)) {
    return UNOCCLUDED_STATE
  }

  const normalizedSurfaceRect = toNativeSurfaceRect(surfaceRect)
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(registration.overlaySelector))

  for (const overlay of overlays) {
    // `contains` also covers `overlay === registration.element`. A floated
    // browser tile lives inside its own `.dv-resize-container`, so without the
    // ancestor half it would occlude itself the moment it is floated.
    if (overlay.contains(registration.element)) continue
    if (!isOverlayCandidateVisible(overlay)) continue

    const overlayRect = expandRect(overlay.getBoundingClientRect(), registration.overlayMargin)
    if (isRectOverlapping(normalizedSurfaceRect, overlayRect)) {
      return {
        occluded: true,
        reason: getOverlayReason(overlay),
        overlayRect,
      }
    }
  }

  return UNOCCLUDED_STATE
}

function refreshObservedOverlays(): void {
  if (!overlayResizeObserver || registrations.size === 0) return

  const nextOverlays = new Set<Element>()
  for (const registration of registrations.values()) {
    document
      .querySelectorAll(registration.overlaySelector)
      .forEach((overlay) => nextOverlays.add(overlay))
  }

  for (const overlay of observedOverlays) {
    if (!nextOverlays.has(overlay)) {
      overlayResizeObserver.unobserve(overlay)
      observedOverlays.delete(overlay)
    }
  }

  for (const overlay of nextOverlays) {
    if (!observedOverlays.has(overlay)) {
      observedOverlays.add(overlay)
      overlayResizeObserver.observe(overlay)
    }
  }
}

function commitOcclusionState(
  registration: NativeSurfaceRegistration,
  nextState: NativeSurfaceOcclusionState,
): void {
  if (statesEqual(registration.lastState, nextState)) return
  registration.lastState = nextState
  registration.callback(nextState)
}

function refreshOcclusionState(): void {
  animationFrame = 0
  refreshObservedOverlays()

  for (const registration of registrations.values()) {
    if (preflightOcclusionState) {
      commitOcclusionState(registration, preflightOcclusionState)
      continue
    }

    const nextState = readOcclusionState(registration)
    commitOcclusionState(registration, nextState)
  }
}

function refreshOcclusionStateImmediately(): void {
  if (!isBrowserRuntimeAvailable()) return
  window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
  refreshOcclusionState()
}

function scheduleOcclusionRefresh(): void {
  if (!isBrowserRuntimeAvailable()) return
  window.cancelAnimationFrame(animationFrame)
  animationFrame = window.requestAnimationFrame(refreshOcclusionState)
}

function ensureObservers(): void {
  if (!isBrowserRuntimeAvailable()) return

  if (!surfaceResizeObserver) {
    surfaceResizeObserver = new ResizeObserver(scheduleOcclusionRefresh)
  }

  if (!overlayResizeObserver) {
    overlayResizeObserver = new ResizeObserver(scheduleOcclusionRefresh)
  }

  if (!mutationObserver && document.body) {
    mutationObserver = new MutationObserver(refreshOcclusionStateImmediately)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-hidden',
        'class',
        'data-native-surface-overlay',
        'data-native-surface-overlay-reason',
        'data-state',
        'hidden',
        'style',
      ],
    })

    window.addEventListener('resize', scheduleOcclusionRefresh)
    window.addEventListener('scroll', scheduleOcclusionRefresh, true)
    window.visualViewport?.addEventListener('resize', scheduleOcclusionRefresh)
    window.visualViewport?.addEventListener('scroll', scheduleOcclusionRefresh)
  }
}

function cleanupObserversIfIdle(): void {
  if (registrations.size > 0) return

  window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
  window.clearTimeout(preflightTimer)
  preflightTimer = 0
  preflightOcclusionState = null

  mutationObserver?.disconnect()
  mutationObserver = null

  surfaceResizeObserver?.disconnect()
  surfaceResizeObserver = null

  overlayResizeObserver?.disconnect()
  overlayResizeObserver = null
  observedOverlays.clear()

  if (isBrowserRuntimeAvailable()) {
    window.removeEventListener('resize', scheduleOcclusionRefresh)
    window.removeEventListener('scroll', scheduleOcclusionRefresh, true)
    window.visualViewport?.removeEventListener('resize', scheduleOcclusionRefresh)
    window.visualViewport?.removeEventListener('scroll', scheduleOcclusionRefresh)
  }
}

export function registerNativeSurfaceOcclusionTarget(
  element: HTMLElement,
  callback: (state: NativeSurfaceOcclusionState) => void,
  options: RegisterNativeSurfaceOptions = {},
): () => void {
  if (!isBrowserRuntimeAvailable()) {
    callback(UNOCCLUDED_STATE)
    return () => {}
  }

  ensureObservers()

  const id = nextRegistrationId
  nextRegistrationId += 1

  const registration: NativeSurfaceRegistration = {
    id,
    element,
    overlaySelector: options.overlaySelector ?? NATIVE_SURFACE_OVERLAY_SELECTOR,
    overlayMargin: options.overlayMargin ?? DEFAULT_OVERLAY_MARGIN,
    callback,
    lastState: UNOCCLUDED_STATE,
  }

  registrations.set(id, registration)
  surfaceResizeObserver?.observe(element)
  refreshOcclusionStateImmediately()

  return () => {
    surfaceResizeObserver?.unobserve(element)
    registrations.delete(id)
    cleanupObserversIfIdle()
  }
}

export function useNativeSurfaceOcclusion<TElement extends HTMLElement>(
  ref: RefObject<TElement | null>,
  options: UseNativeSurfaceOcclusionOptions = {},
): NativeSurfaceOcclusionState {
  const enabled = options.enabled ?? true
  const overlaySelector = options.overlaySelector ?? NATIVE_SURFACE_OVERLAY_SELECTOR
  const overlayMargin = options.overlayMargin ?? DEFAULT_OVERLAY_MARGIN
  const onStateChangeRef = useRef(options.onStateChange)
  const [state, setState] = useState<NativeSurfaceOcclusionState>(UNOCCLUDED_STATE)
  onStateChangeRef.current = options.onStateChange

  useLayoutEffect(() => {
    if (!enabled) {
      setState(UNOCCLUDED_STATE)
      onStateChangeRef.current?.(UNOCCLUDED_STATE)
      return
    }

    const element = ref.current
    if (!element) {
      setState(UNOCCLUDED_STATE)
      onStateChangeRef.current?.(UNOCCLUDED_STATE)
      return
    }

    return registerNativeSurfaceOcclusionTarget(
      element,
      (nextState) => {
        onStateChangeRef.current?.(nextState)
        setState(nextState)
      },
      {
        overlaySelector,
        overlayMargin,
      },
    )
  }, [enabled, overlayMargin, overlaySelector, ref])

  return state
}

export function notifyNativeSurfaceOverlayChanged(): void {
  if (isBrowserRuntimeAvailable() && preflightOcclusionState) {
    window.clearTimeout(preflightTimer)
    preflightTimer = 0
    preflightOcclusionState = null
  }
  refreshOcclusionStateImmediately()
}

export function preflightNativeSurfaceOcclusion(
  reason = 'Overlay opening',
  durationMs = 160,
): void {
  if (!isBrowserRuntimeAvailable() || registrations.size === 0) return

  preflightOcclusionState = {
    occluded: true,
    reason,
    overlayRect: null,
  }

  refreshOcclusionStateImmediately()

  window.clearTimeout(preflightTimer)
  preflightTimer = window.setTimeout(() => {
    preflightTimer = 0
    preflightOcclusionState = null
    refreshOcclusionStateImmediately()
  }, Math.max(16, durationMs))
}

export function useNativeSurfaceOverlayLifecycle(active = true): void {
  useLayoutEffect(() => {
    if (!active) return
    notifyNativeSurfaceOverlayChanged()
    return notifyNativeSurfaceOverlayChanged
  }, [active])
}
