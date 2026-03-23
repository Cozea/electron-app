import { memo, useRef, useState, type MouseEvent } from 'react'
import { Loader2, Smartphone } from 'lucide-react'

import type { NativePreviewSession } from '@shared/electronApiTypes'

interface EmbeddedNativePreviewProps {
  session: NativePreviewSession
}

export const EmbeddedNativePreview = memo(function EmbeddedNativePreview({
  session,
}: EmbeddedNativePreviewProps) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamKey = `${session.id}:${session.streamUrl ?? 'none'}`
  const [loadedStreamKey, setLoadedStreamKey] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null)
  const ready = loadedStreamKey === streamKey
  const error = errorState?.key === streamKey ? errorState.message : null
  const loading = !session.streamUrl || (!ready && !error)
  const isAndroidVideo = session.platform === 'android'

  const handleClick = async (event: MouseEvent<HTMLImageElement | HTMLVideoElement>) => {
    if (session.platform !== 'android') return

    const mediaElement = videoRef.current ?? imageRef.current
    if (!mediaElement) return

    const rect = mediaElement.getBoundingClientRect()
    const naturalWidth = mediaElement instanceof HTMLVideoElement ? mediaElement.videoWidth : mediaElement.naturalWidth
    const naturalHeight = mediaElement instanceof HTMLVideoElement ? mediaElement.videoHeight : mediaElement.naturalHeight
    if (rect.width <= 0 || rect.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
      return
    }

    const relativeX = event.clientX - rect.left
    const relativeY = event.clientY - rect.top
    const scaledX = (relativeX / rect.width) * naturalWidth
    const scaledY = (relativeY / rect.height) * naturalHeight

    await window.electronAPI.nativePreview.sendInput({
      sessionId: session.id,
      type: 'tap',
      x: scaledX,
      y: scaledY,
    })
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#0f1115]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />

      <div className="relative flex h-full w-full items-center justify-center px-10 py-12">
        <div className="relative w-full max-w-[28rem] overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/70 px-4 py-3 text-xs uppercase tracking-[0.22em] text-white/55 backdrop-blur">
            <span>{session.platform === 'ios' ? 'iOS Simulator' : 'Android Emulator'}</span>
            <span>{session.device?.name ?? 'Device'}</span>
          </div>

          <div className="relative aspect-[9/19.5] w-full bg-[#0a0a0a] pt-11">
            {session.streamUrl ? (
              isAndroidVideo ? (
                <video
                  key={streamKey}
                  ref={videoRef}
                  src={session.streamUrl}
                  className="h-full w-full cursor-pointer object-contain"
                  autoPlay
                  muted
                  playsInline
                  controls={false}
                  onLoadedData={() => {
                    setLoadedStreamKey(streamKey)
                    setErrorState(null)
                  }}
                  onError={() => {
                    setLoadedStreamKey(null)
                    setErrorState({
                      key: streamKey,
                      message: 'The embedded native preview video stream could not be loaded.',
                    })
                  }}
                  onClick={(event) => {
                    void handleClick(event)
                  }}
                />
              ) : (
                <img
                  ref={imageRef}
                  src={session.streamUrl}
                  alt={`${session.platform} device preview`}
                  className="h-full w-full object-contain"
                  draggable={false}
                  onLoad={() => {
                    setLoadedStreamKey(streamKey)
                    setErrorState(null)
                  }}
                  onError={() => {
                    setLoadedStreamKey(null)
                    setErrorState({
                      key: streamKey,
                      message: 'The embedded native preview stream could not be loaded.',
                    })
                  }}
                />
              )
            ) : (
              <div className="h-full w-full" />
            )}

            {(loading || error) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/78 px-6 text-center text-white">
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                ) : (
                  <Smartphone className="h-6 w-6 text-white/70" />
                )}
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {loading ? 'Connecting embedded preview…' : 'Embedded preview unavailable'}
                  </p>
                  <p className="text-xs text-white/65">
                    {error ?? session.message ?? 'Waiting for the device stream.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
