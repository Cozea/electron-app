import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Smartphone } from 'lucide-react'

import type { NativePreviewSession } from '@shared/electronApiTypes'

interface EmbeddedNativePreviewProps {
  session: NativePreviewSession | null
  inspectMode?: boolean
  highlightFrame?: { x: number; y: number; width: number; height: number } | null
  onInspect?: (point: { x: number; y: number }) => void
  onRetry?: () => void
}

function eventToRatio(event: ReactPointerEvent<HTMLImageElement>, element: HTMLImageElement): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect()
  const relativeX = event.clientX - rect.left
  const relativeY = event.clientY - rect.top

  if (relativeX < 0 || relativeX > rect.width || relativeY < 0 || relativeY > rect.height) {
    return null
  }

  return {
    x: rect.width > 0 ? relativeX / rect.width : 0.5,
    y: rect.height > 0 ? relativeY / rect.height : 0.5,
  }
}

export const EmbeddedNativePreview = memo(function EmbeddedNativePreview({
  session,
  inspectMode = false,
  highlightFrame = null,
  onInspect,
  onRetry,
}: EmbeddedNativePreviewProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const pointerActiveRef = useRef(false)
  const streamKey = session ? `${session.id}:${session.streamUrl ?? 'none'}` : 'empty-session'
  const [delayedStreamUrl, setDelayedStreamUrl] = useState<string | null>(null)
  const [loadedStreamKey, setLoadedStreamKey] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    pointerActiveRef.current = false
  }, [streamKey])

  useEffect(() => {
    if (!session?.streamUrl) {
      setDelayedStreamUrl(null)
      return
    }

    // React strict mode remounts can briefly double-request the MJPEG endpoint.
    const timeout = setTimeout(() => {
      setDelayedStreamUrl(session.streamUrl ?? null)
    }, 300)
    return () => clearTimeout(timeout)
  }, [session?.streamUrl])

  const ready = loadedStreamKey === streamKey
  const error = errorState?.key === streamKey ? errorState.message : null
  const loading = session && session.state !== 'error' && session.state !== 'stopped' && (!delayedStreamUrl || (!ready && !error))

  const sendTouchCommand = async (
    command: 'touch_down' | 'touch_move' | 'touch_up' | 'tap',
    event: ReactPointerEvent<HTMLImageElement>,
  ) => {
    const element = imgRef.current
    if (!element || !session) return

    const ratio = eventToRatio(event, element)
    if (!ratio) return

    await window.electronAPI.radon.sendDeviceCommand({
      sessionId: session.id,
      command,
      payload: ratio,
    })
  }

  const inspectAtPoint = (event: ReactPointerEvent<HTMLImageElement>) => {
    const element = imgRef.current
    if (!element || !onInspect) return

    const ratio = eventToRatio(event, element)
    if (!ratio) return
    onInspect(ratio)
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent p-6">
      <div
        className="relative flex items-center justify-center"
        style={{
          height: '100%',
          maxHeight: '100%',
          aspectRatio: '1186 / 2564',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            backgroundImage: 'url(/radon-assets/assets/bezel-2WO2PIQB.png)',
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            filter: 'none',
          }}
        />

        <div
          className="absolute z-10 flex items-center justify-center overflow-hidden bg-black"
          style={{
            width: '95%',
            height: '96%',
            borderRadius: '12%',
          }}
        >
          {delayedStreamUrl ? (
            <img
              key={streamKey}
              ref={imgRef}
              src={delayedStreamUrl}
              className={`h-full w-full object-fill ${inspectMode ? 'cursor-crosshair' : 'cursor-pointer'}`}
              onLoad={() => {
                setLoadedStreamKey(streamKey)
                setErrorState(null)
              }}
              onError={() => {
                setLoadedStreamKey(null)
                setErrorState({
                  key: streamKey,
                  message: 'Stream disconnected.',
                })
              }}
              onPointerDown={(event) => {
                if (inspectMode) {
                  pointerActiveRef.current = false
                  event.preventDefault()
                  return
                }
                pointerActiveRef.current = true
                void sendTouchCommand('touch_down', event)
              }}
              onPointerMove={(event) => {
                if (inspectMode) return
                if (!pointerActiveRef.current || event.buttons === 0) return
                void sendTouchCommand('touch_move', event)
              }}
              onPointerUp={(event) => {
                if (inspectMode) {
                  inspectAtPoint(event)
                  return
                }
                if (!pointerActiveRef.current) return
                pointerActiveRef.current = false
                void sendTouchCommand('touch_up', event)
              }}
              onPointerLeave={(event) => {
                if (inspectMode) return
                if (!pointerActiveRef.current) return
                pointerActiveRef.current = false
                void sendTouchCommand('touch_up', event)
              }}
            />
          ) : null}

          {highlightFrame ? (
            <div
              className="pointer-events-none absolute border-2 border-sky-400 shadow-[0_0_0_1px_rgba(15,23,42,0.6)]"
              style={{
                left: `${highlightFrame.x * 100}%`,
                top: `${highlightFrame.y * 100}%`,
                width: `${highlightFrame.width * 100}%`,
                height: `${highlightFrame.height * 100}%`,
              }}
            />
          ) : null}

          {(loading || error || !session || session.state === 'stopped') && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center font-mono text-xs uppercase tracking-widest text-white">
              {loading && session && session.state !== 'stopped' ? (
                <div className="flex flex-col items-center gap-4 text-[#8a8a8a]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-white border-white/20" />
                  <span>{session.message || 'Booting device...'}</span>
                </div>
              ) : (!session || session.state === 'stopped') ? (
                <div className="flex flex-col items-center gap-3 text-[#444444]">
                  <Smartphone className="mb-2 h-8 w-8 opacity-20" />
                  <span>Simulator Offline</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-[#8a8a8a]">
                  <Smartphone className="h-6 w-6 opacity-50" />
                  <span>{error || session.error || 'Waiting for connection'}</span>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-2 rounded-full border border-white/20 px-4 py-1.5 text-[10px] font-medium tracking-[0.18em] text-white transition hover:border-white/40 hover:bg-white/10"
                    >
                      Retry Preview
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
