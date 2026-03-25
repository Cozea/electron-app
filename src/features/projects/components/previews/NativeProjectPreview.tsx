import { memo, useMemo } from 'react'
import { Ellipsis, Play, QrCode } from 'lucide-react'

import androidFrontImage from '@/assets/native-preview/android-front-outline.png'
import iphoneFrontImage from '@/assets/native-preview/iphone-front-outline.png'

import type { NativePreviewLauncher } from './NativePreviewLaunchPill'
import { getExpoQrRows } from './NativePreviewQrPopover'

const INLINE_QR_MODULE_SIZE_PX = 4

interface NativeProjectPreviewProps {
  serverRunning: boolean
  serverStarting: boolean
  serverOutput: string[]
  selectedLauncher: NativePreviewLauncher
  target: 'ios' | 'android' | 'both'
}

function IphoneDeviceIllustration() {
  return <img src={iphoneFrontImage} alt="iPhone preview frame" className="h-[54rem] w-auto max-w-none select-none object-contain" draggable={false} />
}

function AndroidDeviceIllustration() {
  return <img src={androidFrontImage} alt="Android preview frame" className="h-[54rem] w-auto max-w-none select-none object-contain" draggable={false} />
}

export const NativeProjectPreview = memo(function NativeProjectPreview({
  serverRunning,
  serverStarting,
  serverOutput,
  selectedLauncher,
  target,
}: NativeProjectPreviewProps) {
  const previewStopped = !serverRunning && !serverStarting
  const targetLabel = target === 'both' ? 'iOS and Android' : target === 'ios' ? 'iOS' : 'Android'
  const launcherLabel = selectedLauncher === 'simulator' ? 'Simulator' : 'Web'
  const qrRows = useMemo(() => getExpoQrRows(serverOutput), [serverOutput])
  const stateTitle = serverRunning
    ? 'Preview running'
    : serverStarting
      ? 'Starting mobile preview'
      : 'Start mobile preview'
  const stateDescription = serverRunning
    ? 'Scan the QR code to open on your smartphone.'
    : serverStarting
      ? 'Preparing Metro and mobile preview.'
      : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-content-surface">
      <div className="flex flex-1 items-center justify-center px-8 py-10">
        <div className="flex max-w-5xl flex-col items-center text-center">
          <div className="relative mb-2 flex h-[31rem] w-full items-start justify-center overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
              {target === 'ios' ? (
                <IphoneDeviceIllustration />
              ) : target === 'android' ? (
                <AndroidDeviceIllustration />
              ) : (
                <div className="relative flex items-start justify-center">
                  <div className="relative z-10">
                    <IphoneDeviceIllustration />
                  </div>
                  <div className="-ml-24 mt-8">
                    <AndroidDeviceIllustration />
                  </div>
                </div>
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-b from-transparent via-content-surface/60 to-content-surface" />

            <div className="relative z-20 mt-56 max-w-xl px-10">
              <div className="space-y-3">
                {serverRunning && qrRows ? (
                  <div className="mb-5 flex justify-center">
                    <div className="bg-white p-3" aria-label="Expo QR code">
                      <div className="inline-flex flex-col">
                        {qrRows.map((row, rowIndex) => (
                          <div key={`inline-qr-row-${rowIndex}`} className="flex">
                            {row.map((cell, columnIndex) => (
                              <div
                                key={`inline-qr-cell-${rowIndex}-${columnIndex}`}
                                style={{
                                  width: `${INLINE_QR_MODULE_SIZE_PX}px`,
                                  height: `${INLINE_QR_MODULE_SIZE_PX * 2}px`,
                                }}
                              >
                                <div
                                  style={{
                                    width: '100%',
                                    height: `${INLINE_QR_MODULE_SIZE_PX}px`,
                                    backgroundColor: cell.top ? '#000' : '#fff',
                                  }}
                                />
                                <div
                                  style={{
                                    width: '100%',
                                    height: `${INLINE_QR_MODULE_SIZE_PX}px`,
                                    backgroundColor: cell.bottom ? '#000' : '#fff',
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : serverStarting || serverRunning ? (
                  <div className="mb-5 flex justify-center" aria-hidden="true">
                    <div className="origin-center scale-[0.42]">
                      <div className="preview-loading-spinner">
                        <div className="preview-loading-spinner-square" />
                        <div className="preview-loading-spinner-square" />
                        <div className="preview-loading-spinner-square" />
                        <div className="preview-loading-spinner-square" />
                        <div className="preview-loading-spinner-square" />
                      </div>
                    </div>
                  </div>
                ) : null}
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">{stateTitle}</h2>
                {stateDescription ? (
                  <p className="mx-auto max-w-[17rem] text-base leading-7 text-muted-foreground">
                    {stateDescription}
                  </p>
                ) : (
                  <div className="mx-auto inline-flex items-center gap-2 text-base leading-7 text-muted-foreground">
                    <span>Press</span>
                    <span className="inline-flex items-center justify-center">
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </span>
                    <span>in the header.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              {previewStopped ? (
                <Ellipsis className="h-3.5 w-3.5" />
              ) : serverRunning ? (
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              )}
              {previewStopped ? 'Preview stopped' : serverRunning ? 'Preview running' : 'Preview starting'}
            </span>
            <span className="h-3.5 w-px bg-border/60" aria-hidden />
            <span>{targetLabel}</span>
            <span className="h-3.5 w-px bg-border/60" aria-hidden />
            <span>{launcherLabel}</span>
            <span className="h-3.5 w-px bg-border/60" aria-hidden />
            <span className="inline-flex items-center gap-1.5">
              <QrCode className="h-3.5 w-3.5" />
              QR code in header
            </span>
          </div>
        </div>
      </div>
    </div>
  )
})
