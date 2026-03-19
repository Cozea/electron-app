import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { ProjectPreviewThumbnailItem } from './ProjectPreviewThumbnailItem'
import { type PreviewRouteViewModel } from './types'

const THUMBNAIL_ITEM_WIDTH = 104
const THUMBNAIL_ITEM_GAP = 8
const THUMBNAIL_OVERSCAN = 2

interface ProjectPreviewThumbnailStripProps {
  focusedRouteIndex: number | null
  onOpenCode: (file: string) => void
  onSelectRoute: (index: number) => void
  onTogglePagesList: () => void
  routeViewModels: PreviewRouteViewModel[]
}

export const ProjectPreviewThumbnailStrip = memo(function ProjectPreviewThumbnailStrip({
  focusedRouteIndex,
  onOpenCode,
  onSelectRoute,
  onTogglePagesList,
  routeViewModels,
}: ProjectPreviewThumbnailStripProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const syncMetrics = () => {
      setViewportWidth(container.clientWidth)
      setScrollLeft(container.scrollLeft)
    }

    syncMetrics()

    const resizeObserver = new ResizeObserver(() => {
      syncMetrics()
    })
    resizeObserver.observe(container)

    const handleScroll = () => {
      setScrollLeft(container.scrollLeft)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    if (focusedRouteIndex === null) return
    const container = scrollContainerRef.current
    if (!container) return

    const itemStride = THUMBNAIL_ITEM_WIDTH + THUMBNAIL_ITEM_GAP
    const targetLeft = focusedRouteIndex * itemStride
    const targetRight = targetLeft + THUMBNAIL_ITEM_WIDTH
    const currentLeft = container.scrollLeft
    const currentRight = currentLeft + container.clientWidth

    if (targetLeft >= currentLeft && targetRight <= currentRight) {
      return
    }

    const centeredLeft = Math.max(0, targetLeft - Math.max(0, (container.clientWidth - THUMBNAIL_ITEM_WIDTH) / 2))
    container.scrollTo({
      left: centeredLeft,
      behavior: 'smooth',
    })
  }, [focusedRouteIndex])

  const { endIndex, startIndex } = useMemo(() => {
    if (routeViewModels.length === 0) {
      return { endIndex: 0, startIndex: 0 }
    }

    const itemStride = THUMBNAIL_ITEM_WIDTH + THUMBNAIL_ITEM_GAP
    const visibleCount = Math.max(1, Math.ceil(viewportWidth / itemStride))
    const rawStartIndex = Math.floor(scrollLeft / itemStride)
    const startIndex = Math.max(0, rawStartIndex - THUMBNAIL_OVERSCAN)
    const endIndex = Math.min(
      routeViewModels.length,
      startIndex + visibleCount + THUMBNAIL_OVERSCAN * 2
    )

    return { endIndex, startIndex }
  }, [routeViewModels.length, scrollLeft, viewportWidth])

  const itemStride = THUMBNAIL_ITEM_WIDTH + THUMBNAIL_ITEM_GAP
  const leftSpacerWidth = Math.max(0, startIndex * itemStride - (startIndex > 0 ? THUMBNAIL_ITEM_GAP : 0))
  const trailingCount = Math.max(0, routeViewModels.length - endIndex)
  const rightSpacerWidth = Math.max(0, trailingCount * itemStride - (trailingCount > 0 ? THUMBNAIL_ITEM_GAP : 0))
  const visibleRouteViewModels = routeViewModels.slice(startIndex, endIndex)

  return (
    <div className="flex items-center gap-3">
      <div
        ref={scrollContainerRef}
        className="app-scrollbar flex-1 overflow-x-auto pb-0.5"
      >
        <div className="flex min-w-max gap-2">
          {leftSpacerWidth > 0 ? (
            <div
              className="shrink-0"
              style={{ width: leftSpacerWidth }}
              aria-hidden
            />
          ) : null}
          {visibleRouteViewModels.map((routeViewModel, index) => {
            const absoluteIndex = startIndex + index
            return (
              <ProjectPreviewThumbnailItem
                key={routeViewModel.route.path}
                isActive={absoluteIndex === focusedRouteIndex}
                onOpenCode={onOpenCode}
                onSelect={() => onSelectRoute(absoluteIndex)}
                onTogglePagesList={onTogglePagesList}
                routeViewModel={routeViewModel}
              />
            )
          })}
          {rightSpacerWidth > 0 ? (
            <div
              className="shrink-0"
              style={{ width: rightSpacerWidth }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>
      {focusedRouteIndex !== null ? (
        <div className="shrink-0 rounded-full bg-muted/50 px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
          {focusedRouteIndex + 1}/{routeViewModels.length}
        </div>
      ) : null}
    </div>
  )
})
