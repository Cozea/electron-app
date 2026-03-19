import { memo, type MutableRefObject } from 'react'
import { AppWindow, ExternalLink, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TaskFocusOverlay } from '@/features/projects/components/TaskFocusOverlay'
import type { TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'

import { type PreviewDevice, type PreviewRouteViewModel } from './types'

interface FocusedProjectPreviewProps {
  credentiallessAttribute?: '' | undefined
  device: PreviewDevice
  focusedPreviewFrameName: string
  focusedPreviewUrl: string | null
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  onIframeError: () => void
  onIframeLoad: () => void
  onOpenCode: (file: string) => void
  onOpenExternally: () => void
  onRetryPreview: () => void
  previewEmbedBlocked: boolean
  previewEmbedMode: 'credentialless' | 'standard'
  previewFailureMessage: string
  previewFailureTitle: string
  previewReloadToken: number
  recentPreviewTimeline: Array<{ id: string; message: string }>
  routePreviewImageUrl: string | null
  routeViewModel: PreviewRouteViewModel
  serverRunning: boolean
  showPreviewFailureOverlay: boolean
  taskOverlay: TaskOverlayPayload | null
  zoom: number
}

export const FocusedProjectPreview = memo(function FocusedProjectPreview({
  credentiallessAttribute,
  device,
  focusedPreviewFrameName,
  focusedPreviewUrl,
  iframeRef,
  onIframeError,
  onIframeLoad,
  onOpenCode,
  onOpenExternally,
  onRetryPreview,
  previewEmbedBlocked,
  previewEmbedMode,
  previewFailureMessage,
  previewFailureTitle,
  previewReloadToken,
  recentPreviewTimeline,
  routePreviewImageUrl,
  routeViewModel,
  serverRunning,
  showPreviewFailureOverlay,
  taskOverlay,
  zoom,
}: FocusedProjectPreviewProps) {
  const staticPreviewUrl = routePreviewImageUrl ?? routeViewModel.fallbackPreviewImageUrl

  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4 pt-14">
          <div
            className={cn(
              'group/focused-preview relative overflow-hidden rounded-xl border border-border/40 bg-card shadow-xl transition-[transform,box-shadow,border-color] duration-300 ease-out',
              device === 'desktop' ? 'h-full w-full' : 'h-full',
              device === 'mobile' && 'w-[375px]',
              device === 'tablet' && 'w-[768px]'
            )}
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center center',
            }}
          >
            {serverRunning && focusedPreviewUrl ? (
              <div className="relative h-full w-full bg-content-surface">
                <iframe
                  ref={iframeRef}
                  key={`focused-preview-${previewEmbedMode}-${previewReloadToken}-${routeViewModel.route.path}`}
                  name={focusedPreviewFrameName}
                  src={focusedPreviewUrl}
                  credentialless={credentiallessAttribute}
                  className="h-full w-full border-none"
                  onLoad={onIframeLoad}
                  onError={onIframeError}
                />
              </div>
            ) : staticPreviewUrl ? (
              <img
                src={staticPreviewUrl}
                alt=""
                className="h-full w-full object-cover object-top"
                loading="eager"
                decoding="async"
                draggable={false}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <AppWindow className="mb-4 h-16 w-16 opacity-20" />
                <p className="text-lg">Start dev server for live preview</p>
                <p className="mt-1 text-sm text-muted-foreground/60">{routeViewModel.route.path}</p>
              </div>
            )}

            {routeViewModel.route.type === 'dynamic' ? (
              <div className="absolute right-3 top-3 rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
                Dynamic
              </div>
            ) : null}

            {taskOverlay?.context.kind === 'page' ? (
              <TaskFocusOverlay task={taskOverlay} className="z-30" />
            ) : (
              <div className="pointer-events-none absolute bottom-4 right-4 flex translate-y-2 items-center gap-2 opacity-0 transition-all duration-200 ease-out group-hover/focused-preview:pointer-events-auto group-hover/focused-preview:translate-y-0 group-hover/focused-preview:opacity-100">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenCode(routeViewModel.route.file)}
                  className="shadow-md"
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Open
                </Button>
                {serverRunning ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenExternally}
                    className="shadow-md"
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Browser
                  </Button>
                ) : null}
              </div>
            )}

            <div className="absolute bottom-4 left-4 flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1 text-sm font-medium text-secondary-foreground shadow-md">
                {routeViewModel.route.name}
              </div>
            </div>

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
          </div>
        </div>
      </div>
    </div>
  )
})
