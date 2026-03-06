import { memo, useRef } from 'react'
import {
  AppWindow,
  RefreshCw,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'
import type { DevServerStatus } from '@/hooks/useDevServerManager'

interface BuildPreviewPanelProps {
  status: DevServerStatus
  url: string | null
  error: string | null
  timeline?: Array<{ id: string; at: number; type: string; message: string }>
  refreshToken?: number
  onRefresh?: () => void
  className?: string
}

/**
 * Preview panel for the build page showing live dev server output
 */
export const BuildPreviewPanel = memo(function BuildPreviewPanel({
  status,
  url,
  error,
  timeline,
  refreshToken = 0,
  onRefresh,
  className,
}: BuildPreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {/* Content area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Idle state - waiting for build */}
        {status === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <AppWindow className="h-16 w-16 opacity-50 animate-pulse" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Preview will appear here</p>
              <Shimmer className="text-xs text-muted-foreground/70">
                Waiting for dependencies to install...
              </Shimmer>
            </div>
          </div>
        )}

        {/* Starting state - dev server booting with shimmer */}
        {status === 'starting' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <AppWindow className="h-16 w-16 opacity-50 animate-pulse" />
            <div className="text-center space-y-1">
              <Shimmer className="text-sm font-medium">Starting dev server...</Shimmer>
              <p className="text-xs text-muted-foreground/70">Compiling your project</p>
            </div>
          </div>
        )}

        {/* Ready state - show iframe */}
        {status === 'ready' && url && (
          <iframe
            ref={iframeRef}
            key={`${url}-${refreshToken}`}
            src={url}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-modals"
            title="Project Preview"
          />
        )}

        {/* Error state */}
        {(status === 'error' || status === 'unhealthy') && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="rounded-full bg-destructive/10 p-6">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm font-medium text-destructive">
                {status === 'unhealthy' ? 'Preview is unhealthy' : 'Failed to start preview'}
              </p>
              {error && (
                <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-3">{error}</p>
              )}
              {timeline && timeline.length > 0 && (
                <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-2 text-left">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent events</p>
                  <div className="mt-1 space-y-1">
                    {timeline.slice(-3).reverse().map((event) => (
                      <p key={event.id} className="text-[11px] leading-4 text-muted-foreground">
                        {event.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh} className="mt-2">
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Try again
              </Button>
            )}
          </div>
        )}

        {/* Stopped state */}
        {status === 'stopped' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <AppWindow className="h-16 w-16 opacity-50" />
            <div className="text-center">
              <p className="text-sm font-medium">Preview stopped</p>
              <p className="text-xs text-muted-foreground/70">The dev server has been stopped</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
