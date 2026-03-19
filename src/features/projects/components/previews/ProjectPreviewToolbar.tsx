import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  LayoutGrid,
  Loader2,
  Monitor,
  MousePointer2,
  RefreshCw,
  Smartphone,
  Tablet,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { type PreviewDevice } from './types'

const MIN_ZOOM_PERCENT = 25
const MAX_ZOOM_PERCENT = 200
const ZOOM_STEP_PERCENT = 25

interface ProjectPreviewToolbarProps {
  device: PreviewDevice
  focused: boolean
  inspectorEnabled: boolean
  isCapturingScreenshot: boolean
  onBackToGrid: () => void
  onCaptureScreenshot: () => void
  onDeviceChange: (device: PreviewDevice) => void
  onRefreshRoutes: () => void
  onRetryBridge: () => void
  onToggleInspector: () => void
  onZoomChange: (zoom: number) => void
  previewEmbedBlocked: boolean
  previewReady: boolean
  serverRunning: boolean
  useCredentiallessPreview: boolean
  zoom: number
}

function clampZoomPercent(value: number): number {
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, Math.round(value)))
}

export const ProjectPreviewToolbar = memo(function ProjectPreviewToolbar({
  device,
  focused,
  inspectorEnabled,
  isCapturingScreenshot,
  onBackToGrid,
  onCaptureScreenshot,
  onDeviceChange,
  onRefreshRoutes,
  onRetryBridge,
  onToggleInspector,
  onZoomChange,
  previewEmbedBlocked,
  previewReady,
  serverRunning,
  useCredentiallessPreview,
  zoom,
}: ProjectPreviewToolbarProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerWidth, setHeaderWidth] = useState(0)
  const [zoomInputValue, setZoomInputValue] = useState(String(zoom))

  useEffect(() => {
    setZoomInputValue(String(zoom))
  }, [zoom])

  useEffect(() => {
    const element = headerRef.current
    if (!element) return

    const syncWidth = () => {
      setHeaderWidth(Math.round(element.getBoundingClientRect().width))
    }

    syncWidth()
    const resizeObserver = new ResizeObserver(() => {
      syncWidth()
    })
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const toolbarDensity = useMemo<'compact' | 'full' | 'minimal'>(() => {
    if (headerWidth >= 860) return 'full'
    if (headerWidth >= 640) return 'compact'
    return 'minimal'
  }, [headerWidth])

  const commitZoomInput = () => {
    const normalized = zoomInputValue.replace('%', '').trim()
    if (!normalized) {
      setZoomInputValue(String(zoom))
      return
    }

    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) {
      setZoomInputValue(String(zoom))
      return
    }

    const nextZoom = clampZoomPercent(parsed)
    onZoomChange(nextZoom)
    setZoomInputValue(String(nextZoom))
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={headerRef} className="flex items-center gap-2">
        {focused ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBackToGrid}
                  className="h-7 gap-2 px-2"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {toolbarDensity === 'full' ? <span className="text-xs">Grid</span> : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Back to grid view</p>
              </TooltipContent>
            </Tooltip>
            <div className="h-4 w-px bg-border/60" />
          </>
        ) : null}

        {focused && toolbarDensity === 'full' ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={device === 'desktop' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onDeviceChange('desktop')}
                    className={cn('h-7 w-7 rounded-full', device === 'desktop' && 'bg-sidebar-accent shadow-none')}
                  >
                    <Monitor className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Desktop</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={device === 'tablet' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onDeviceChange('tablet')}
                    className={cn('h-7 w-7 rounded-full', device === 'tablet' && 'bg-sidebar-accent shadow-none')}
                  >
                    <Tablet className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Tablet (768px)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={device === 'mobile' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onDeviceChange('mobile')}
                    className={cn('h-7 w-7 rounded-full', device === 'mobile' && 'bg-sidebar-accent shadow-none')}
                  >
                    <Smartphone className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Mobile (375px)</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-4 w-px bg-border/60" />

            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onZoomChange(clampZoomPercent(zoom - ZOOM_STEP_PERCENT))}
                    className="h-7 w-7 rounded-full"
                    disabled={zoom <= MIN_ZOOM_PERCENT}
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onZoomChange(100)}
                    className="min-w-[3rem] h-7 px-2 text-xs font-mono"
                  >
                    {zoom}%
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reset to 100%</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onZoomChange(clampZoomPercent(zoom + ZOOM_STEP_PERCENT))}
                    className="h-7 w-7 rounded-full"
                    disabled={zoom >= MAX_ZOOM_PERCENT}
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom in</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : null}

        {focused && toolbarDensity !== 'full' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'group/zoom-trigger h-7 overflow-hidden rounded-full shadow-none transition-colors duration-200 hover:bg-secondary/70 hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-secondary-foreground',
                  toolbarDensity === 'compact' ? 'gap-2 px-2' : 'min-w-7 justify-center gap-0 px-1.5'
                )}
              >
                {device === 'desktop' ? (
                  <Monitor className="h-4 w-4" />
                ) : device === 'tablet' ? (
                  <Tablet className="h-4 w-4" />
                ) : (
                  <Smartphone className="h-4 w-4" />
                )}
                {toolbarDensity === 'compact' ? (
                  <span className="min-w-[3rem] text-xs font-mono tabular-nums">{zoom}%</span>
                ) : null}
                <span className="zoom-chevron-slot flex w-0 items-center justify-end overflow-hidden opacity-0 transition-all duration-200 group-hover/zoom-trigger:ml-1 group-hover/zoom-trigger:w-4 group-hover/zoom-trigger:opacity-70 group-data-[state=open]/zoom-trigger:ml-1 group-data-[state=open]/zoom-trigger:w-4 group-data-[state=open]/zoom-trigger:opacity-70">
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/zoom-trigger:rotate-180" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">View</div>
              <DropdownMenuItem onClick={() => onDeviceChange('desktop')}>
                <Monitor className="mr-2 h-4 w-4" />
                Desktop
                {device === 'desktop' ? <CheckCircle2 className="ml-auto h-3 w-3 text-green-500" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDeviceChange('tablet')}>
                <Tablet className="mr-2 h-4 w-4" />
                Tablet (768px)
                {device === 'tablet' ? <CheckCircle2 className="ml-auto h-3 w-3 text-green-500" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDeviceChange('mobile')}>
                <Smartphone className="mr-2 h-4 w-4" />
                Mobile (375px)
                {device === 'mobile' ? <CheckCircle2 className="ml-auto h-3 w-3 text-green-500" /> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Zoom</div>
              <div className="px-2 pb-2">
                <div className="flex h-8 w-full items-center justify-center px-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onZoomChange(clampZoomPercent(zoom - ZOOM_STEP_PERCENT))}
                    disabled={zoom <= MIN_ZOOM_PERCENT}
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <div className="mx-2 h-4 w-px bg-border/60" />
                  <div className="flex w-14 items-center justify-center gap-0.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={zoomInputValue}
                      onChange={(event) => {
                        const next = event.target.value.replace('%', '').trim()
                        if (next === '' || /^\d{0,3}$/.test(next)) {
                          setZoomInputValue(next)
                        }
                      }}
                      onBlur={commitZoomInput}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitZoomInput()
                          event.currentTarget.blur()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setZoomInputValue(String(zoom))
                          event.currentTarget.blur()
                        }
                      }}
                      className="h-6 w-10 border-0 bg-transparent p-0 text-center text-sm font-medium text-foreground outline-none"
                      aria-label="Zoom percent"
                    />
                    <span className="text-[11px] text-muted-foreground">%</span>
                  </div>
                  <div className="mx-2 h-4 w-px bg-border/60" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onZoomChange(clampZoomPercent(zoom + ZOOM_STEP_PERCENT))}
                    disabled={zoom >= MAX_ZOOM_PERCENT}
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <div className="flex min-w-0 items-center gap-2">
          {serverRunning && useCredentiallessPreview ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold leading-none text-amber-950 dark:text-amber-100"
                  aria-label="Compat preview"
                >
                  !
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Legacy compat preview active</TooltipContent>
            </Tooltip>
          ) : null}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Preview actions">
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Preview actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onRefreshRoutes}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh routes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRetryBridge}>
                <span
                  className={cn(
                    'mr-2 h-2.5 w-2.5 shrink-0 rounded-full',
                    previewReady ? 'bg-green-500' : 'bg-amber-500'
                  )}
                  aria-hidden
                />
                Retry Bridge Connection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {focused && serverRunning ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isCapturingScreenshot || !previewReady || previewEmbedBlocked}
                    onClick={onCaptureScreenshot}
                  >
                    {isCapturingScreenshot ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {previewEmbedBlocked
                    ? 'Preview blocked. Open externally.'
                    : previewReady
                      ? 'Take screenshot'
                      : 'Preview not ready yet'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={inspectorEnabled ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    disabled={!previewReady || previewEmbedBlocked}
                    onClick={onToggleInspector}
                  >
                    <MousePointer2 className={cn('h-3.5 w-3.5', inspectorEnabled ? 'text-foreground' : 'text-muted-foreground')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {previewEmbedBlocked
                    ? 'Preview blocked. Open externally.'
                    : previewReady
                      ? inspectorEnabled
                        ? 'Disable inspector'
                        : 'Enable inspector'
                      : 'Preview not ready yet'}
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
})
