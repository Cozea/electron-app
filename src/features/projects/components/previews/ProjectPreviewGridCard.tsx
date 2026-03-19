import { memo, useEffect, useRef, useState } from 'react'
import { AppWindow, ExternalLink, FileText } from 'lucide-react'

import { CompactPresenceIndicator } from '@/components/presence/CompactPresenceIndicator'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { type PreviewRouteViewModel } from './types'

interface ProjectPreviewGridCardProps {
  credentiallessAttribute?: '' | undefined
  livePreviewEnabled: boolean
  onOpenCode: (file: string) => void
  onOpenRoute: (index: number) => void
  onVisibilityChange?: (routePath: string, visible: boolean) => void
  previewEmbedMode: 'credentialless' | 'standard'
  previewReloadToken: number
  routeIndex: number
  routeViewModel: PreviewRouteViewModel
  serverRunning: boolean
}

export const ProjectPreviewGridCard = memo(function ProjectPreviewGridCard({
  credentiallessAttribute,
  livePreviewEnabled,
  onOpenCode,
  onOpenRoute,
  onVisibilityChange,
  previewEmbedMode,
  previewReloadToken,
  routeIndex,
  routeViewModel,
  serverRunning,
}: ProjectPreviewGridCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const target = containerRef.current
    if (!target || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const nextVisible = entries[0]?.isIntersecting ?? false
        setVisible(nextVisible)
      },
      {
        rootMargin: '200px',
        threshold: 0.15,
      }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    onVisibilityChange?.(routeViewModel.route.path, visible)
  }, [onVisibilityChange, routeViewModel.route.path, visible])

  const staticPreviewUrl = routeViewModel.previewImageUrl ?? routeViewModel.fallbackPreviewImageUrl

  return (
    <div ref={containerRef} className="group relative">
      <Card
        className="group relative flex h-[220px] cursor-pointer flex-col gap-0 overflow-hidden border-border/40 bg-card/50 p-0 shadow-sm transition-all duration-300 hover:border-sidebar-primary/20 hover:bg-card hover:shadow-md"
        onClick={() => onOpenRoute(routeIndex)}
      >
        <div className="relative flex-1 overflow-hidden rounded-t-xl bg-muted/30">
          {livePreviewEnabled && routeViewModel.previewUrl ? (
            <div className="absolute inset-0">
              {staticPreviewUrl ? (
                <img
                  src={staticPreviewUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-top"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              ) : null}
              <div className="absolute inset-0 overflow-hidden bg-background">
                <iframe
                  key={`grid-preview-${previewEmbedMode}-${previewReloadToken}-${routeViewModel.route.path}`}
                  src={routeViewModel.previewUrl}
                  credentialless={credentiallessAttribute}
                  loading="lazy"
                  className="block h-[200%] w-[200%] origin-top-left scale-50 select-none border-none pointer-events-none"
                  tabIndex={-1}
                />
                <div className="absolute inset-0 bg-transparent" />
              </div>
            </div>
          ) : staticPreviewUrl ? (
            <img
              src={staticPreviewUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-top"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <AppWindow className="mb-2 h-8 w-8 text-muted-foreground/20" />
              <span className="text-center text-xs font-medium text-muted-foreground/40">
                {serverRunning
                  ? visible
                    ? 'Live preview warming up'
                    : 'Preview activates when visible'
                  : 'Start server to preview'}
              </span>
            </div>
          )}

          {routeViewModel.route.type === 'dynamic' ? (
            <div className="absolute left-2 top-2 rounded border border-yellow-500/10 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-600 backdrop-blur-sm dark:text-yellow-400">
              Dynamic
            </div>
          ) : null}

          <div className="absolute bottom-2 right-2 z-20 flex translate-y-2 items-center gap-1.5 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 bg-background/80 px-2 text-[10px] shadow-sm backdrop-blur-sm hover:bg-background"
              onClick={(event) => {
                event.stopPropagation()
                onOpenCode(routeViewModel.route.file)
              }}
            >
              <FileText className="mr-1.5 h-3 w-3" />
              Edit
            </Button>

            {serverRunning && routeViewModel.previewUrl ? (
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 bg-background/80 shadow-sm backdrop-blur-sm hover:bg-background"
                onClick={(event) => {
                  event.stopPropagation()
                  window.open(routeViewModel.previewUrl ?? undefined, '_blank')
                }}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-auto px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-medium text-foreground/90" title={routeViewModel.route.path}>
              {routeViewModel.route.name}
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {routeViewModel.presenceUsers.length > 0 ? (
                <CompactPresenceIndicator
                  users={routeViewModel.presenceUsers}
                  size="sm"
                  className="shrink-0"
                />
              ) : null}
              <span className="max-w-[40%] shrink-0 truncate rounded bg-muted/50 px-1.5 py-0.5 text-right font-mono text-[10px] text-muted-foreground/60">
                {routeViewModel.route.path}
              </span>
            </div>
          </div>
          <div className="mt-1 min-w-0">
            <p className="line-clamp-1 min-w-0 flex-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {routeViewModel.route.description ?? ''}
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
})
