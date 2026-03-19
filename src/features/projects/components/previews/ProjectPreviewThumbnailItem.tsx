import { memo } from 'react'
import { AppWindow, FileText, PanelLeft } from 'lucide-react'

import { CompactPresenceIndicator } from '@/components/presence/CompactPresenceIndicator'
import { cn } from '@/lib/utils'

import { type PreviewRouteViewModel } from './types'

interface ProjectPreviewThumbnailItemProps {
  isActive: boolean
  onOpenCode: (file: string) => void
  onSelect: () => void
  onTogglePagesList: () => void
  routeViewModel: PreviewRouteViewModel
}

export const ProjectPreviewThumbnailItem = memo(function ProjectPreviewThumbnailItem({
  isActive,
  onOpenCode,
  onSelect,
  onTogglePagesList,
  routeViewModel,
}: ProjectPreviewThumbnailItemProps) {
  const staticPreviewUrl = routeViewModel.previewImageUrl ?? routeViewModel.fallbackPreviewImageUrl

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group flex shrink-0 flex-col items-center gap-1 outline-none transition-all focus:outline-none focus-visible:ring-0',
        isActive ? 'opacity-100' : 'opacity-50 hover:opacity-100'
      )}
    >
      <div
        className={cn(
          'relative h-14 w-24 overflow-hidden rounded border-2',
          isActive ? 'border-primary ring-1 ring-primary/20' : 'border-border/40 hover:border-border'
        )}
      >
        {staticPreviewUrl ? (
          <img
            src={staticPreviewUrl}
            alt=""
            className="h-full w-full object-cover object-top"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/50">
            <AppWindow className="h-3 w-3 text-muted-foreground/30" />
          </div>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onTogglePagesList()
          }}
          className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded border border-border/50 bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
          aria-label="Toggle pages list"
        >
          <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenCode(routeViewModel.route.file)
          }}
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded border border-border/50 bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
          aria-label="Open code file"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {routeViewModel.presenceUsers.length > 0 ? (
          <div className="absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background/90 p-[1px] shadow-sm backdrop-blur-sm">
            <CompactPresenceIndicator
              users={routeViewModel.presenceUsers}
              size="xs"
              showOverflow={false}
              className="gap-0"
            />
          </div>
        ) : null}
      </div>
      <div className="w-24">
        <span
          className={cn(
            'block min-w-0 truncate text-[10px]',
            isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
          )}
          title={routeViewModel.route.name}
        >
          {routeViewModel.route.name}
        </span>
      </div>
    </div>
  )
})
