import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { scheduleTask } from "@/lib/scheduler"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { CommandSearch } from "@/components/CommandSearch"
import { LayoutToggles } from "@/components/layouts/LayoutToggles"

interface UnifiedHeaderProps {
  breadcrumbs: { label: string; href?: string }[]
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  rightAddon?: ReactNode
  className?: string
  leftWindowControlsInset?: boolean
  contentInsetLeft?: number
  contentInsetRight?: number
  compactHeaderActions?: boolean
}

export function UnifiedHeader({
  breadcrumbs,
  header,
  breadcrumbAddon,
  rightAddon,
  className,
  leftWindowControlsInset = false,
  contentInsetLeft = 0,
  contentInsetRight = 0,
  compactHeaderActions = true,
}: UnifiedHeaderProps) {
  const isWindowsClient = typeof window !== "undefined" && window.electronAPI?.platform === "win32"
  const isMacClient = typeof window !== "undefined" && window.electronAPI?.platform === "darwin"
  const isAssistantOpen = useAssistantPanelStore((state) => state.mode !== "closed")
  const shouldShowWindowsCaptionSpacer = isWindowsClient && !isAssistantOpen
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth()
  const shouldApplyLeftWindowControlsInset = leftWindowControlsInset && isMacClient
  const headerBackdropClassName = isWindowsClient
    ? "bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/45"
    : "bg-transparent backdrop-blur-md"

  const [isFullScreen, setIsFullScreen] = useState(false)
  const [visibleBreadcrumbStartIndex, setVisibleBreadcrumbStartIndex] = useState(0)
  const breadcrumbContainerRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbViewportRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbMeasureRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbAddonRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!shouldApplyLeftWindowControlsInset) {
      setIsFullScreen(false)
      return
    }

    let isMounted = true

    void window.electronAPI?.window?.isFullScreen?.()
      .then((fullscreen) => {
        if (isMounted) setIsFullScreen(Boolean(fullscreen))
      })
      .catch(() => {
        if (isMounted) setIsFullScreen(false)
      })

    const cleanup = window.electronAPI?.window?.onFullScreenChange?.((fullscreen) => {
      if (isMounted) setIsFullScreen(Boolean(fullscreen))
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [shouldApplyLeftWindowControlsInset])

  const windowControlsInsetPadding = shouldApplyLeftWindowControlsInset
    ? { paddingLeft: isFullScreen ? 8 : 74 }
    : undefined
  const rightFrameInset = shouldShowWindowsCaptionSpacer ? 0 : contentInsetRight
  const headerFrameStyle = {
    ...windowControlsInsetPadding,
    left: contentInsetLeft,
    right: rightFrameInset,
  }
  const visibleBreadcrumbs = useMemo(
    () =>
      breadcrumbs.slice(visibleBreadcrumbStartIndex).map((crumb, index) => ({
        crumb,
        originalIndex: visibleBreadcrumbStartIndex + index,
      })),
    [breadcrumbs, visibleBreadcrumbStartIndex]
  )
  const hasCollapsedLeftBreadcrumbs = visibleBreadcrumbStartIndex > 0

  const recomputeVisibleBreadcrumbs = useCallback(() => {
    if (!breadcrumbs.length) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    const viewport = breadcrumbViewportRef.current
    const container = breadcrumbContainerRef.current
    const measure = breadcrumbMeasureRef.current
    const addon = breadcrumbAddonRef.current

    if (!viewport || !measure) return

    const addonWidth = breadcrumbAddon ? (addon?.getBoundingClientRect().width ?? 0) + 8 : 0
    const availableWidth = Math.max(
      0,
      (container?.clientWidth ?? viewport.clientWidth) - addonWidth
    )
    if (availableWidth <= 0) return

    const crumbNodes = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-breadcrumb-measure-crumb]")
    )
    const separatorNode = measure.querySelector<HTMLElement>(
      "[data-breadcrumb-measure-separator]"
    )
    const ellipsisNode = measure.querySelector<HTMLElement>(
      "[data-breadcrumb-measure-ellipsis]"
    )

    if (!crumbNodes.length) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    const crumbWidths = crumbNodes.map((node) => node.getBoundingClientRect().width)
    const separatorWidth = separatorNode?.getBoundingClientRect().width ?? 10
    const ellipsisWidth = ellipsisNode?.getBoundingClientRect().width ?? 20

    const allCrumbsWidth =
      crumbWidths.reduce((acc, width) => acc + width, 0) +
      Math.max(0, crumbWidths.length - 1) * separatorWidth

    if (allCrumbsWidth <= availableWidth) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    let startIndex = crumbWidths.length - 1

    for (let candidate = 1; candidate < crumbWidths.length; candidate += 1) {
      const remainingCrumbsWidth = crumbWidths
        .slice(candidate)
        .reduce((acc, width) => acc + width, 0)
      const remainingSeparatorsWidth =
        Math.max(0, crumbWidths.length - candidate - 1) * separatorWidth
      const candidateWidth =
        ellipsisWidth + separatorWidth + remainingCrumbsWidth + remainingSeparatorsWidth

      if (candidateWidth <= availableWidth) {
        startIndex = candidate
        break
      }
    }

    setVisibleBreadcrumbStartIndex(startIndex)
  }, [breadcrumbAddon, breadcrumbs])

  useEffect(() => {
    if (!breadcrumbs.length) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    const viewport = breadcrumbViewportRef.current
    const container = breadcrumbContainerRef.current
    if (!viewport || !container) return

    const scheduleRecompute = () => {
      void scheduleTask(() => {
        recomputeVisibleBreadcrumbs()
      }, 'background')
    }

    const frame = window.requestAnimationFrame(() => {
      scheduleRecompute()
    })

    const observer = new ResizeObserver(() => {
      scheduleRecompute()
    })
    observer.observe(container)
    observer.observe(viewport)
    if (breadcrumbAddonRef.current) {
      observer.observe(breadcrumbAddonRef.current)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [breadcrumbAddon, breadcrumbs.length, recomputeVisibleBreadcrumbs])

  const isTabsPrimaryLayout =
    breadcrumbs.length === 0 && !breadcrumbAddon && Boolean(header)

  if (isTabsPrimaryLayout) {
    return (
      <div
        className={cn(
          "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-2 titlebar-drag-region",
          headerBackdropClassName,
          className
        )}
        style={headerFrameStyle}
      >
        <div className="flex items-center w-full gap-0.5">
          <div className="flex items-center min-w-0 flex-1">
            {compactHeaderActions ? (
              <div className="shared-header-action-pills titlebar-no-drag inline-flex min-w-0 items-center">
                {header}
              </div>
            ) : (
              <div className="titlebar-no-drag inline-flex min-w-0 max-w-full items-center">
                {header}
              </div>
            )}
          </div>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
          <div className="flex items-center gap-0 titlebar-no-drag shrink-0">
            <CommandSearch />
            <LayoutToggles />
            {rightAddon && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-4 titlebar-drag-region",
        headerBackdropClassName,
        className
      )}
      style={headerFrameStyle}
    >
      <div className="flex items-center w-full gap-3">
        <div
          ref={breadcrumbContainerRef}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          {breadcrumbs.length > 0 && (
            <>
              <div ref={breadcrumbViewportRef} className="titlebar-no-drag min-w-0 max-w-full overflow-hidden">
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
                    {hasCollapsedLeftBreadcrumbs && (
                      <>
                        <BreadcrumbItem className="shrink-0">
                          <BreadcrumbEllipsis className="size-6" />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="shrink-0" />
                      </>
                    )}
                    {visibleBreadcrumbs.map(({ crumb, originalIndex }, index) => {
                      const isLast = originalIndex === breadcrumbs.length - 1

                      return (
                        <Fragment key={`${crumb.label}-${originalIndex}`}>
                          <BreadcrumbItem className="min-w-0">
                            {crumb.href && !isLast ? (
                              <BreadcrumbLink
                                asChild
                                className="inline-block max-w-[240px] truncate align-bottom"
                              >
                                <Link to={crumb.href}>{crumb.label}</Link>
                              </BreadcrumbLink>
                            ) : (
                              <BreadcrumbPage className="inline-block max-w-[260px] truncate align-bottom text-muted-foreground/80">
                                {crumb.label}
                              </BreadcrumbPage>
                            )}
                          </BreadcrumbItem>
                          {index < visibleBreadcrumbs.length - 1 && (
                            <BreadcrumbSeparator className="shrink-0" />
                          )}
                        </Fragment>
                      )
                    })}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>

              {/* Hidden measuring row used to calculate responsive left-ellipsis behavior */}
              <div
                ref={breadcrumbMeasureRef}
                className="pointer-events-none absolute -z-10 opacity-0"
                aria-hidden="true"
              >
                <Breadcrumb>
                  <BreadcrumbList className="flex-nowrap">
                    <BreadcrumbItem className="shrink-0">
                      <BreadcrumbEllipsis
                        className="size-6"
                        data-breadcrumb-measure-ellipsis
                      />
                    </BreadcrumbItem>
                    <BreadcrumbSeparator
                      className="shrink-0"
                      data-breadcrumb-measure-separator
                    />
                    {breadcrumbs.map((crumb, index) => (
                      <BreadcrumbItem
                        key={`measure-${crumb.label}-${index}`}
                        className="shrink-0"
                        data-breadcrumb-measure-crumb
                      >
                        <span className="inline-block whitespace-nowrap">
                          {crumb.label}
                        </span>
                      </BreadcrumbItem>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </>
          )}
          {breadcrumbAddon && (
            <div ref={breadcrumbAddonRef} className="titlebar-no-drag flex shrink-0 items-center gap-2">
              {breadcrumbAddon}
            </div>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 titlebar-no-drag">
          {compactHeaderActions ? (
            <div className="shared-header-action-pills flex min-w-0 items-center">
              {header}
            </div>
          ) : (
            header
          )}
          {header && (
            <div className="mx-1.5 h-4 w-px shrink-0 bg-border/70" />
          )}
          <div className="flex items-center gap-0.5">
            <CommandSearch />
            <LayoutToggles />
            {rightAddon && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
