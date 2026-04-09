import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { ArrowPathIcon as RefreshCw, ArrowTopRightOnSquareIcon as ExternalLink, DevicePhoneMobileIcon as Smartphone } from "@heroicons/react/24/outline"

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { TaskFocusOverlay } from '@/features/projects/components/TaskFocusOverlay'
import type { TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'
import type { PageRoute } from '@/features/projects/lib/previewRuntimeTypes'
import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewRotation,
  NativePreviewSessionState,
} from '@shared/nativePreviewTypes'

import type { PreviewDevice } from './types'

const MIN_PREVIEW_SCALE = 0.5
const MAX_PREVIEW_SCALE = 3

interface IosSimulatorViewportProps {
  device: PreviewDevice
  route: PageRoute
  serverRunning: boolean
  sessionState: NativePreviewSessionState | null
  simulators: NativePreviewIosSimulatorDevice[]
  selectedSimulatorId: string | null
  simulatorsLoading: boolean
  simulatorsError: string | null
  sessionLoading: boolean
  sessionError: string | null
  taskOverlay: TaskOverlayPayload | null
  onSelectSimulator: (deviceId: string) => void
  onRefreshSimulators: () => void
  onOpenExternally: () => void
  onSendTouches: (request: {
    type: 'start' | 'move' | 'end'
    touches: Array<{ xRatio: number; yRatio: number }>
    rotation?: NativePreviewRotation
  }) => Promise<void>
  onSendWheel: (request: {
    point: { xRatio: number; yRatio: number }
    deltaX: number
    deltaY: number
  }) => Promise<void>
  onSendKey: (request: {
    direction: 'down' | 'up'
    keyCode: number
  }) => Promise<void>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export const IosSimulatorViewport = memo(function IosSimulatorViewport({
  device,
  route,
  serverRunning,
  sessionState,
  simulators,
  selectedSimulatorId,
  simulatorsLoading,
  simulatorsError,
  sessionLoading,
  sessionError,
  taskOverlay,
  onSelectSimulator,
  onRefreshSimulators,
  onOpenExternally,
  onSendTouches,
  onSendWheel,
  onSendKey,
}: IosSimulatorViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const frameSurfaceRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const activeTouchPointerIdRef = useRef<number | null>(null)
  const activePanPointerIdRef = useRef<number | null>(null)
  const transformStateRef = useRef({ scale: 1, x: 0, y: 0 })
  const transformRafRef = useRef<number | null>(null)
  const [keyboardFocused, setKeyboardFocused] = useState(false)

  const selectedSimulator = useMemo(() => {
    return simulators.find((deviceOption) => deviceOption.udid === selectedSimulatorId) ?? null
  }, [selectedSimulatorId, simulators])

  const streamUrl = sessionState?.streamUrl ?? null
  const interactionEnabled = Boolean(streamUrl && sessionState?.status === 'running')

  const previewShellClassName = useMemo(() => {
    return cn(
      'group/native-preview relative overflow-hidden bg-content-surface transition-[width,height] duration-200 ease-out will-change-transform outline-none',
      device === 'desktop' ? 'h-full w-full' : 'h-full',
      device === 'mobile' && 'w-[375px]',
      device === 'tablet' && 'w-[768px]'
    )
  }, [device])

  const scheduleTransformFlush = useCallback(() => {
    if (transformRafRef.current !== null) return
    transformRafRef.current = window.requestAnimationFrame(() => {
      transformRafRef.current = null
      const surface = frameSurfaceRef.current
      if (!surface) return
      const { scale, x, y } = transformStateRef.current
      surface.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    })
  }, [])

  const clampTransform = useCallback((next: { scale: number; x: number; y: number }) => {
    const viewport = viewportRef.current
    const surface = frameSurfaceRef.current
    const clampedScale = clamp(next.scale, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE)

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
      x: clamp(next.x, -maxOffsetX, maxOffsetX),
      y: clamp(next.y, -maxOffsetY, maxOffsetY),
    }
  }, [])

  const resetTransform = useCallback(() => {
    transformStateRef.current = { scale: 1, x: 0, y: 0 }
    scheduleTransformFlush()
  }, [scheduleTransformFlush])

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
    const nextScale = clamp(current.scale * scaleFactor, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE)
    const ratio = nextScale / current.scale

    transformStateRef.current = clampTransform({
      scale: nextScale,
      x: current.x + (pointX - centerX - current.x) * (1 - ratio),
      y: current.y + (pointY - centerY - current.y) * (1 - ratio),
    })
    scheduleTransformFlush()
  }, [clampTransform, scheduleTransformFlush])

  useEffect(() => {
    resetTransform()
  }, [device, resetTransform, route.path, streamUrl])

  useEffect(() => {
    return () => {
      if (transformRafRef.current !== null) {
        window.cancelAnimationFrame(transformRafRef.current)
      }
    }
  }, [])

  const eventToRatios = useCallback((clientX: number, clientY: number) => {
    const image = imageRef.current
    if (!image) {
      return null
    }

    const rect = image.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    return {
      xRatio: clamp((clientX - rect.left) / rect.width, 0, 1),
      yRatio: clamp((clientY - rect.top) / rect.height, 0, 1),
    }
  }, [])

  const sendTouchFromPointer = useCallback(async (
    type: 'start' | 'move' | 'end',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const ratios = eventToRatios(event.clientX, event.clientY)
    if (!ratios) {
      return
    }

    await onSendTouches({
      type,
      touches: [ratios],
      rotation: sessionState?.rotation ?? 'Portrait',
    })
  }, [eventToRatios, onSendTouches, sessionState?.rotation])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return
    }

    if (event.button === 1) {
      activePanPointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0) {
      return
    }

    activeTouchPointerIdRef.current = event.pointerId
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    void sendTouchFromPointer('start', event)
  }, [interactionEnabled, sendTouchFromPointer])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePanPointerIdRef.current === event.pointerId) {
      applyPanDelta(event.movementX, event.movementY)
      return
    }

    if (activeTouchPointerIdRef.current !== event.pointerId || !interactionEnabled) {
      return
    }

    event.preventDefault()
    void sendTouchFromPointer('move', event)
  }, [applyPanDelta, interactionEnabled, sendTouchFromPointer])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePanPointerIdRef.current === event.pointerId) {
      activePanPointerIdRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }

    if (activeTouchPointerIdRef.current !== event.pointerId || !interactionEnabled) {
      return
    }

    activeTouchPointerIdRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    event.preventDefault()
    void sendTouchFromPointer('end', event)
  }, [interactionEnabled, sendTouchFromPointer])

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePanPointerIdRef.current === event.pointerId) {
      activePanPointerIdRef.current = null
      return
    }

    if (activeTouchPointerIdRef.current !== event.pointerId || !interactionEnabled) {
      return
    }

    activeTouchPointerIdRef.current = null
    void sendTouchFromPointer('end', event)
  }, [interactionEnabled, sendTouchFromPointer])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const scaleFactor = Math.exp(-event.deltaY * 0.0015)
      applyZoomAtPoint(scaleFactor, event.clientX, event.clientY)
      return
    }

    if (!interactionEnabled) {
      return
    }

    const ratios = eventToRatios(event.clientX, event.clientY)
    if (!ratios) {
      return
    }

    event.preventDefault()
    void onSendWheel({
      point: ratios,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    })
  }, [applyZoomAtPoint, eventToRatios, interactionEnabled, onSendWheel])

  const handleKeyEvent = useCallback((direction: 'down' | 'up', event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return
    }

    const keyCode = event.keyCode || event.which
    if (!keyCode) {
      return
    }

    if (
      event.key === ' ' ||
      event.key.startsWith('Arrow') ||
      event.key === 'Tab'
    ) {
      event.preventDefault()
    }

    void onSendKey({
      direction,
      keyCode,
    })
  }, [interactionEnabled, onSendKey])

  const emptyState = useMemo(() => {
    if (simulatorsLoading) {
      return 'Loading iOS simulators...'
    }
    if (simulatorsError) {
      return simulatorsError
    }
    if (!selectedSimulator) {
      return 'Select an iOS simulator to begin native preview.'
    }
    if (selectedSimulator.state !== 'Booted') {
      return 'Boot the selected iOS simulator to start native preview.'
    }
    if (!serverRunning) {
      return 'Start the native dev server to connect the preview runtime.'
    }
    if (sessionError) {
      return sessionError
    }
    if (sessionLoading || sessionState?.status === 'starting') {
      return 'Starting native preview session...'
    }
    return 'Waiting for the simulator stream.'
  }, [selectedSimulator, serverRunning, sessionError, sessionLoading, sessionState?.status, simulatorsError, simulatorsLoading])

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
            tabIndex={0}
            className={previewShellClassName}
            style={{ transform: 'translate3d(0px, 0px, 0) scale(1)', transformOrigin: 'center center' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onWheel={handleWheel}
            onKeyDown={(event) => handleKeyEvent('down', event)}
            onKeyUp={(event) => handleKeyEvent('up', event)}
            onFocus={() => setKeyboardFocused(true)}
            onBlur={() => setKeyboardFocused(false)}
          >
            {streamUrl ? (
              <div className="relative h-full w-full bg-content-surface">
                <img
                  ref={imageRef}
                  src={streamUrl}
                  alt={`${selectedSimulator?.name ?? 'iOS simulator'} preview`}
                  className="h-full w-full select-none object-contain"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-content-surface px-6 text-center text-muted-foreground">
                <Smartphone className="h-16 w-16 opacity-20" />
                <div className="space-y-2">
                  <p className="text-lg text-foreground/90">{emptyState}</p>
                  {selectedSimulator ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedSimulator.name} · {selectedSimulator.state}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={onRefreshSimulators}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Refresh
                  </Button>
                  <Button size="sm" variant="outline" onClick={onOpenExternally} disabled={!streamUrl}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Stream
                  </Button>
                </div>
              </div>
            )}

            <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2">
              <Select
                value={selectedSimulatorId ?? undefined}
                onValueChange={onSelectSimulator}
                disabled={simulatorsLoading || simulators.length === 0}
              >
                <SelectTrigger className="h-8 w-[220px] rounded-lg border-border/70 bg-background/85 text-xs shadow-sm backdrop-blur">
                  <SelectValue placeholder="Select iOS simulator" />
                </SelectTrigger>
                <SelectContent>
                  {simulators.map((simulator) => (
                    <SelectItem key={simulator.udid} value={simulator.udid}>
                      {simulator.name} · {simulator.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="icon" variant="outline" className="h-8 w-8 rounded-lg bg-background/85 backdrop-blur" onClick={onRefreshSimulators}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-lg border border-border/70 bg-background/85 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              <span>{sessionState?.status ?? 'idle'}</span>
              {keyboardFocused ? <span>Keyboard capture on</span> : null}
              {streamUrl ? <span>MJPEG live</span> : null}
            </div>

            {route.type === 'dynamic' ? (
              <div className="absolute right-3 top-3 rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
                Dynamic
              </div>
            ) : null}

            {taskOverlay?.context.kind === 'page' ? (
              <TaskFocusOverlay task={taskOverlay} className="z-30" />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
})
