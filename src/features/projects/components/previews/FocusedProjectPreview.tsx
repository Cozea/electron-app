import { memo, useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { AppWindow, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TaskFocusOverlay } from '@/features/projects/components/TaskFocusOverlay'
import type { TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'
import type { PageRoute } from '@/stores/useProjectPagesStore'
import type { BridgeMessage } from '@/utils/previewBridge'

import { type PreviewDevice } from './types'

const MIN_PREVIEW_SCALE = 0.5
const MAX_PREVIEW_SCALE = 3

interface PreviewWheelPayload {
  clientX: number
  clientY: number
  ctrlKey?: boolean
  deltaY: number
  metaKey?: boolean
}

interface PreviewPanPayload {
  deltaX: number
  deltaY: number
  phase: 'end' | 'move' | 'start'
}

interface PreviewPinchPayload {
  centerX: number
  centerY: number
  deltaX: number
  deltaY: number
  scaleDelta: number
}

interface FocusedProjectPreviewProps {
  credentiallessAttribute?: '' | undefined
  device: PreviewDevice
  focusedPreviewFrameName: string
  focusedPreviewUrl: string | null
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  onIframeError: () => void
  onIframeLoad: () => void
  onOpenExternally: () => void
  onRetryPreview: () => void
  previewEmbedBlocked: boolean
  previewEmbedMode: 'credentialless' | 'standard'
  previewFailureMessage: string
  previewFailureTitle: string
  previewLoading: boolean
  previewReloadToken: number
  recentPreviewTimeline: Array<{ id: string; message: string }>
  route: PageRoute
  serverRunning: boolean
  showPreviewFailureOverlay: boolean
  taskOverlay: TaskOverlayPayload | null
}

export const FocusedProjectPreview = memo(function FocusedProjectPreview({
  credentiallessAttribute,
  device,
  focusedPreviewFrameName,
  focusedPreviewUrl,
  iframeRef,
  onIframeError,
  onIframeLoad,
  onOpenExternally,
  onRetryPreview,
  previewEmbedBlocked,
  previewEmbedMode,
  previewFailureMessage,
  previewFailureTitle,
  previewLoading,
  previewReloadToken,
  recentPreviewTimeline,
  route,
  serverRunning,
  showPreviewFailureOverlay,
  taskOverlay,
}: FocusedProjectPreviewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const frameSurfaceRef = useRef<HTMLDivElement | null>(null)
  const transformStateRef = useRef({ scale: 1, x: 0, y: 0 })
  const transformRafRef = useRef<number | null>(null)

  const setPanningCursor = useCallback((active: boolean) => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.style.cursor = active ? 'grabbing' : ''
  }, [])

  const scheduleTransformFlush = useCallback(() => {
    if (transformRafRef.current !== null) return
    transformRafRef.current = window.requestAnimationFrame(() => {
      transformRafRef.current = null
      const surface = frameSurfaceRef.current
      if (!surface) return
      const { scale, x, y } = transformStateRef.current
      surface.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      const viewportStateMessage: BridgeMessage = {
        type: 'host:set-viewport-state',
        payload: {
          canPan: scale > 1.01,
        },
      }
      iframeRef.current?.contentWindow?.postMessage(viewportStateMessage, '*')
    })
  }, [iframeRef])

  const clampTransform = useCallback((next: { scale: number; x: number; y: number }) => {
    const viewport = viewportRef.current
    const surface = frameSurfaceRef.current
    const clampedScale = Math.max(MIN_PREVIEW_SCALE, Math.min(MAX_PREVIEW_SCALE, next.scale))

    if (!viewport || !surface) {
      return { scale: clampedScale, x: next.x, y: next.y }
    }

    const viewportWidth = viewport.clientWidth
    const viewportHeight = viewport.clientHeight
    const baseWidth = surface.offsetWidth
    const baseHeight = surface.offsetHeight
    const maxOffsetX = Math.max(0, (baseWidth * clampedScale - viewportWidth) / 2)
    const maxOffsetY = Math.max(0, (baseHeight * clampedScale - viewportHeight) / 2)

    return {
      scale: clampedScale,
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, next.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, next.y)),
    }
  }, [])

  const applyPanDelta = useCallback((deltaX: number, deltaY: number) => {
    const current = transformStateRef.current
    if (current.scale <= 1) return
    transformStateRef.current = clampTransform({
      scale: current.scale,
      x: current.x + deltaX,
      y: current.y + deltaY,
    })
    scheduleTransformFlush()
  }, [clampTransform, scheduleTransformFlush])

  const applyZoomAtPoint = useCallback((scaleFactor: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport || !Number.isFinite(scaleFactor) || scaleFactor === 0) return

    const current = transformStateRef.current
    const viewportRect = viewport.getBoundingClientRect()
    const centerX = viewportRect.width / 2
    const centerY = viewportRect.height / 2
    const pointX = clientX - viewportRect.left
    const pointY = clientY - viewportRect.top
    const proposedScale = current.scale * scaleFactor
    const nextScale = Math.max(MIN_PREVIEW_SCALE, Math.min(MAX_PREVIEW_SCALE, proposedScale))
    const ratio = nextScale / current.scale

    const next = clampTransform({
      scale: nextScale,
      x: current.x + (pointX - centerX - current.x) * (1 - ratio),
      y: current.y + (pointY - centerY - current.y) * (1 - ratio),
    })

    transformStateRef.current = next
    scheduleTransformFlush()
  }, [clampTransform, scheduleTransformFlush])

  const resetTransform = useCallback(() => {
    transformStateRef.current = { scale: 1, x: 0, y: 0 }
    scheduleTransformFlush()
    setPanningCursor(false)
  }, [scheduleTransformFlush, setPanningCursor])

  useEffect(() => {
    resetTransform()
  }, [device, resetTransform, route.path, serverRunning])

  useEffect(() => {
    scheduleTransformFlush()
  }, [previewReloadToken, scheduleTransformFlush])

  useEffect(() => {
    return () => {
      if (transformRafRef.current !== null) {
        window.cancelAnimationFrame(transformRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleBridgeGesture = (event: MessageEvent<BridgeMessage>) => {
      const activeWindow = iframeRef.current?.contentWindow
      const message = event.data
      if (!activeWindow || !message || event.source !== activeWindow) return

      switch (message.type) {
        case 'bridge:viewport-wheel': {
          const payload = message.payload as PreviewWheelPayload | undefined
          if (!payload || !(payload.ctrlKey || payload.metaKey)) return
          const scaleFactor = Math.exp(-payload.deltaY * 0.0015)
          applyZoomAtPoint(scaleFactor, payload.clientX, payload.clientY)
          break
        }
        case 'bridge:viewport-pan': {
          const payload = message.payload as PreviewPanPayload | undefined
          if (!payload) return
          if (payload.phase === 'start') {
            setPanningCursor(true)
            return
          }
          if (payload.phase === 'end') {
            setPanningCursor(false)
            return
          }
          applyPanDelta(payload.deltaX, payload.deltaY)
          break
        }
        case 'bridge:viewport-pinch': {
          const payload = message.payload as PreviewPinchPayload | undefined
          if (!payload) return
          applyPanDelta(payload.deltaX, payload.deltaY)
          applyZoomAtPoint(payload.scaleDelta, payload.centerX, payload.centerY)
          break
        }
      }
    }

    window.addEventListener('message', handleBridgeGesture)
    return () => window.removeEventListener('message', handleBridgeGesture)
  }, [applyPanDelta, applyZoomAtPoint, iframeRef, setPanningCursor])

  const previewShellClassName = useMemo(() => {
    return cn(
      'group/focused-preview relative overflow-hidden bg-content-surface transition-[width,height] duration-200 ease-out will-change-transform',
      device === 'desktop' ? 'h-full w-full' : 'h-full',
      device === 'mobile' && 'w-[375px]',
      device === 'tablet' && 'w-[768px]'
    )
  }, [device])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={viewportRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          onDoubleClick={resetTransform}
        >
          <div
            ref={frameSurfaceRef}
            className={previewShellClassName}
            style={{ transform: 'translate3d(0px, 0px, 0) scale(1)', transformOrigin: 'center center' }}
          >
            {serverRunning && focusedPreviewUrl ? (
              <div className="relative h-full w-full bg-content-surface">
                <iframe
                  ref={iframeRef}
                  key={`focused-preview-${previewEmbedMode}-${previewReloadToken}-${route.path}`}
                  name={focusedPreviewFrameName}
                  src={focusedPreviewUrl}
                  credentialless={credentiallessAttribute}
                  className="h-full w-full border-none"
                  onLoad={onIframeLoad}
                  onError={onIframeError}
                />
              </div>
            ) : previewLoading ? (
              <div className="h-full w-full bg-content-surface" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <AppWindow className="mb-4 h-16 w-16 opacity-20" />
                <p className="text-lg">Start dev server for live preview</p>
              </div>
            )}

            {route.type === 'dynamic' ? (
              <div className="absolute right-3 top-3 rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
                Dynamic
              </div>
            ) : null}

            {taskOverlay?.context.kind === 'page' ? (
              <TaskFocusOverlay task={taskOverlay} className="z-30" />
            ) : null}
            {showPreviewFailureOverlay ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-sm">
                <div className="max-w-md rounded-xl border border-border/80 bg-card p-4 shadow-xl">
                  <p className="text-sm font-semibold">{previewFailureTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{previewFailureMessage}</p>
                  {recentPreviewTimeline.length > 0 ? (
                    <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Recent diagnostics
                      </p>
                      <div className="mt-1 space-y-1">
                        {recentPreviewTimeline.slice(0, 3).map((event) => (
                          <p key={event.id} className="text-[11px] leading-4 text-muted-foreground">
                            {event.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={onRetryPreview}>
                      Retry
                    </Button>
                    <Button size="sm" onClick={onOpenExternally} disabled={previewEmbedBlocked && !focusedPreviewUrl}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Browser
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {previewLoading ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
                <div className="text-center text-sm text-foreground">
                  <div className="preview-loading-spinner" aria-hidden="true">
                    <div className="preview-loading-spinner-square" />
                    <div className="preview-loading-spinner-square" />
                    <div className="preview-loading-spinner-square" />
                    <div className="preview-loading-spinner-square" />
                    <div className="preview-loading-spinner-square" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
})
