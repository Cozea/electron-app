import { memo, useCallback, useRef, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  AppWindow,
  RefreshCw,
  Camera,
  AlertCircle,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'
import type { DevServerStatus } from '@/hooks/useDevServerManager'

interface BuildPreviewPanelProps {
  status: DevServerStatus
  url: string | null
  error: string | null
  onRefresh?: () => void
  onCapture?: () => Promise<void>
  onOpenExternal?: () => void
  className?: string
}

/**
 * Preview panel for the build page showing live dev server output
 */
export const BuildPreviewPanel = memo(function BuildPreviewPanel({
  status,
  url,
  error,
  onRefresh,
  onCapture,
  onOpenExternal,
  className,
}: BuildPreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isCapturing, setIsCapturing] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    onRefresh?.()
  }, [onRefresh])

  const handleOpenExternal = useCallback(() => {
    if (url) {
      window.electronAPI.shell.openExternal(url)
    }
    onOpenExternal?.()
  }, [url, onOpenExternal])

  const handleCapture = useCallback(async () => {
    if (!onCapture) return
    setIsCapturing(true)
    try {
      await onCapture()
    } finally {
      setIsCapturing(false)
    }
  }, [onCapture])

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {/* Toolbar - matches chat panel header height (h-12) with blur */}
      <div className="flex items-center gap-3 h-12 px-4 bg-background/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Preview</span>
        </div>

        {/* URL display */}
        {url && status === 'ready' && (
          <div className="flex-1 px-2">
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs font-mono text-muted-foreground">
              <span className="truncate">{url}</span>
            </div>
          </div>
        )}

        {!url && <div className="flex-1" />}

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {status === 'ready' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRefresh}
                title="Refresh preview"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {onCapture && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCapture}
                  disabled={isCapturing}
                  title="Capture screenshot"
                >
                  {isCapturing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleOpenExternal}
                title="Open in browser"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

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
            key={refreshKey}
            src={url}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-modals"
            title="Project Preview"
          />
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="rounded-full bg-destructive/10 p-6">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm font-medium text-destructive">Failed to start preview</p>
              {error && (
                <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-3">{error}</p>
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
