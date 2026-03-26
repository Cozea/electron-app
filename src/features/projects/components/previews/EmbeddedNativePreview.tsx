import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, type KeyboardEvent as ReactKeyboardEvent, type ClipboardEvent as ReactClipboardEvent } from 'react'
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

  const ready = loadedStreamKey === streamKey
  const error = errorState?.key === streamKey ? errorState.message : null
  const loading = session && session.state !== 'error' && session.state !== 'stopped' && (!delayedStreamUrl || (!ready && !error))
  const [bootProgress, setBootProgress] = useState(0)

  // Emulate exact Radon IDE progress logic via stage weights
  useEffect(() => {
    if (!loading) {
      if (ready) setBootProgress(100)
      return
    }

    const stages = [
      { message: 'Initializing device', weight: 1 },
      { message: 'Starting packager', weight: 1 },
      { message: 'Booting device', weight: 2 },
      { message: 'Building', weight: 7 },
      { message: 'Installing', weight: 1 },
      { message: 'Launching', weight: 1 },
      { message: 'Waiting for app to load', weight: 6 },
      { message: 'Attaching debugger', weight: 1 },
      // Fallbacks for Cozea's specific status messages
      { message: 'Preparing', weight: 1 },
      { message: 'Starting preview', weight: 2 },
      { message: 'Streaming native preview', weight: 6 }
    ]

    const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0)
    const currentMsg = session?.message || ''
    
    // Reset if we are at the very beginning
    if (currentMsg.toLowerCase().includes('preparing') || currentMsg.toLowerCase().includes('initializing')) {
      setBootProgress(0)
    }
    
    // Find the closest matching stage by string match
    let stageIndex = stages.findIndex(s => currentMsg.toLowerCase().includes(s.message.toLowerCase()))
    
    if (stageIndex === -1) {
      // Default to "Booting device" if no match
      stageIndex = stages.findIndex(s => s.message === 'Booting device')
    }

    const previousWeights = stages.slice(0, stageIndex).reduce((sum, stage) => sum + stage.weight, 0)
    // stageProgress is inherently 0 in the binary, so we just use the previous weight sum
    const newProgress = (previousWeights / totalWeight) * 100
    
    // Ensure we don't drop backward in progress if messages come out of order
    setBootProgress(prev => (newProgress === 0 ? 0 : Math.max(prev, newProgress)))

  }, [session?.message, loading, ready])

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

  const sendWheelCommand = async (event: ReactWheelEvent<HTMLImageElement>) => {
    if (!session) return
    await window.electronAPI.radon.sendDeviceCommand({
      sessionId: session.id,
      command: 'wheel',
      payload: { x: event.deltaX, y: event.deltaY },
    })
  }

  const handleKeyDown = async (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!session) return
    // Ignore meta keys to let system shortcuts work, unless we need specific keys.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    
    let text = event.key
    if (text.length > 1) {
      if (text === 'Enter') text = '\n'
      else if (text === 'Backspace') text = '\b'
      else return // Ignore other control keys
    }

    event.preventDefault()
    await window.electronAPI.radon.sendDeviceCommand({
      sessionId: session.id,
      command: 'sendKeys',
      payload: { text },
    })
  }

  const handlePaste = async (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!session) return
    const text = event.clipboardData.getData('text/plain')
    if (text) {
      event.preventDefault()
      await window.electronAPI.radon.sendDeviceCommand({
        sessionId: session.id,
        command: 'setClipboard',
        payload: { text },
      })
    }
  }

  const inspectAtPoint = (event: ReactPointerEvent<HTMLImageElement>) => {
    const element = imgRef.current
    if (!element || !onInspect) return

    const ratio = eventToRatio(event, element)
    if (!ratio) return
    onInspect(ratio)
  }

  const isLandscape = session?.rotation === 'LandscapeLeft' || session?.rotation === 'LandscapeRight'
  const isTablet = session?.device?.name?.toLowerCase().includes('ipad') || session?.device?.name?.toLowerCase().includes('tablet')
  
  // Base dimensions based on type, then swap for landscape
  let baseAspect = isTablet ? '3 / 4' : '9 / 19.5'
  if (isLandscape) {
    baseAspect = isTablet ? '4 / 3' : '19.5 / 9'
  }

  return (
    <div 
      className="phone-wrapper relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent p-6 focus:outline-none group"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onWheel={sendWheelCommand}
    >
      <div
        className="phone-content relative flex items-center justify-center transition-all duration-300"
        style={{
          height: '100%',
          maxHeight: '100%',
          aspectRatio: baseAspect,
          maxWidth: '100%',
        }}
      >
        <div
          className="absolute z-10 flex items-center justify-center overflow-hidden bg-black transition-all duration-300"
          style={{
            width: '95%',
            height: '96%',
            borderRadius: isTablet ? '3%' : '12%',
          }}
        >
          {delayedStreamUrl ? (
            <img
              key={streamKey}
              ref={imgRef}
              src={delayedStreamUrl}
              className={`h-full w-full object-fill ${inspectMode ? 'cursor-crosshair' : 'cursor-pointer'}`}
              onLoad={() => {
                console.log(`[NativePreview] img onLoad triggered for ${streamKey}`)
                setLoadedStreamKey(streamKey)
                setErrorState(null)
              }}
              onError={() => {
                // The stream often takes a few seconds to start accepting connections (CONNECTION_REFUSED)
                // We intentionally suppress this error log so it doesn't spam the console.
                // The daemon will update session.state = 'error' if it actually crashes.
                setLoadedStreamKey(null)
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
        </div>

        <img
          src="/radon-assets/assets/bezel-2WO2PIQB.png"
          className="phone-frame pointer-events-none absolute inset-0 z-20 h-full w-full object-contain"
          style={{
            filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.5)) drop-shadow(0 0 0 1px #333)',
            transform: isLandscape ? 'rotate(-90deg)' : 'none',
          }}
          data-testid="device-frame"
          alt="Device Frame"
        />

        {(loading || error || !session || session.state === 'stopped' || session.state === 'error') && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center font-mono text-xs uppercase tracking-widest text-white"
            style={{
              width: '95%',
              height: '96%',
              borderRadius: isTablet ? '3%' : '12%',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)'
            }}
          >
            {loading && session && session.state !== 'stopped' ? (
              <div className="preview-loader-wrapper portrait">
                <style>{`
                  .preview-loader-wrapper { width: 75%; max-width: 285px; display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100%; flex-wrap: nowrap; container-type: size; container-name: preview-loader; }
                  .preview-loader-load-info { display: flex; flex-direction: column; align-items: center; width: 100%; color: #fff; }
                  .preview-loader-container { width: 100%; cursor: default; background: transparent; border: none; padding: 0; text-align: left; }
                  .preview-loader-button-group { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; width: 100%; }
                  .preview-loader-message { text-wrap: nowrap; width: 100%; text-align: left; color: var(--off-white, #eee); font-size: 13px; margin-bottom: 4px; }
                  .preview-loader-stage-progress { color: #8a8a8a; font-size: 13px; font-variant-numeric: tabular-nums; }
                  .progress-bar-root { width: 100%; margin-bottom: 8px; height: 4px; background-color: #333; border-radius: 2px; overflow: hidden; }
                  .progress-bar-indicator { height: 100%; background-color: #00a9f0; }
                  .preview-loader-submessage { width: 100%; margin-bottom: 8px; font-size: 11px; color: #8a8a8a; text-align: center; text-transform: none; letter-spacing: normal; margin-top: 16px; }
                `}</style>
                <div className="preview-loader-load-info">
                  <button type="button" className="preview-loader-container">
                    <div className="preview-loader-button-group">
                      <span className="preview-loader-message font-sans">{session.message || 'Booting device...'}</span>
                      {bootProgress > 0 && <div className="preview-loader-stage-progress font-sans">{bootProgress.toFixed(1)}%</div>}
                    </div>
                  </button>
                  <div className="progress-bar-root">
                    <div 
                      className="progress-bar-indicator" 
                      style={{
                        transform: `translateX(-${100 - bootProgress}%)`,
                        transition: bootProgress > 0 ? 'transform 660ms cubic-bezier(0.65, 0, 0.35, 1)' : 'none',
                      }}
                    />
                  </div>
                  {bootProgress > 75 && (
                    <div className="preview-loader-submessage font-sans">
                      Loading app takes longer than expected. If nothing happens after a while try checking the terminal logs or restarting the preview.
                    </div>
                  )}
                </div>
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
  )
})
