import { memo, useMemo, useRef, useState } from 'react'
import { AppWindow, Route } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { PageRoute } from '@/stores/useProjectPagesStore'

function normalizePreviewPath(path?: string | null): string {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

interface ProjectPreviewRouteBarProps {
  currentRoute: PageRoute | null
  currentPath?: string | null
  routes: PageRoute[]
  onSelectRoute: (route: PageRoute) => void
}

export const ProjectPreviewRouteBar = memo(function ProjectPreviewRouteBar({
  currentRoute,
  currentPath,
  routes,
  onSelectRoute,
}: ProjectPreviewRouteBarProps) {
  const widthClassName = 'w-[28rem] max-w-[42vw] min-w-0 max-xl:w-[22rem] max-lg:w-[18rem] max-[980px]:hidden'
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(() => normalizePreviewPath(currentRoute?.path))
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const currentRoutePath = normalizePreviewPath(currentPath ?? currentRoute?.path)
  const inputValue = open ? query : currentRoutePath

  const filteredRoutes = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    const normalizedQuery = normalizePreviewPath(trimmedQuery)

    const scored = routes.map((route, index) => {
      const name = route.name.toLowerCase()
      const path = normalizePreviewPath(route.path).toLowerCase()

      let score = 0
      if (!trimmedQuery) {
        score = 1
      } else if (path === normalizedQuery || name === trimmedQuery) {
        score = 5
      } else if (path.startsWith(normalizedQuery) || name.startsWith(trimmedQuery)) {
        score = 4
      } else if (path.includes(trimmedQuery) || name.includes(trimmedQuery)) {
        score = 3
      }

      return { route, score, index }
    })

    return scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.index - right.index
      })
      .slice(0, 8)
      .map((entry) => entry.route)
  }, [query, routes])

  const commitRoute = (route: PageRoute) => {
    onSelectRoute(route)
    setQuery(normalizePreviewPath(route.path))
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.blur()
    })
  }

  const handleSubmit = () => {
    const exactMatch = routes.find((route) => {
      const normalizedPath = normalizePreviewPath(route.path).toLowerCase()
      const normalizedQuery = normalizePreviewPath(query.trim()).toLowerCase()
      return normalizedPath === normalizedQuery || route.name.toLowerCase() === query.trim().toLowerCase()
    })

    if (exactMatch) {
      commitRoute(exactMatch)
      return
    }

    const fallbackMatch = filteredRoutes[highlightedIndex] ?? filteredRoutes[0]
    if (fallbackMatch) {
      commitRoute(fallbackMatch)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={widthClassName}>
          <div className="flex h-7 items-center gap-2 rounded-full border border-border/60 bg-secondary/70 px-3 shadow-none">
            <AppWindow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlightedIndex(0)
                if (!open) setOpen(true)
              }}
              onFocus={() => {
                setQuery(currentRoutePath)
                setHighlightedIndex(0)
                setOpen(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setOpen(true)
                  setHighlightedIndex((current) => {
                    if (filteredRoutes.length === 0) return 0
                    return Math.min(current + 1, filteredRoutes.length - 1)
                  })
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setHighlightedIndex((current) => Math.max(current - 1, 0))
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSubmit()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setQuery(currentRoutePath)
                  setOpen(false)
                  inputRef.current?.blur()
                }
              }}
              placeholder="Go to route"
              className="h-full rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none ring-0 focus-visible:ring-0"
            />
            <Route className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-[28rem] max-w-[42vw] rounded-2xl border border-border/60 bg-secondary p-1 shadow-xl max-xl:w-[22rem] max-lg:w-[18rem] max-[980px]:hidden"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="max-h-72 overflow-y-auto">
          {filteredRoutes.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching routes
            </div>
          ) : (
            filteredRoutes.map((route, index) => {
              const normalizedPath = normalizePreviewPath(route.path)
              const isActive = currentRoute?.path === route.path
              const isHighlighted = index === highlightedIndex

              return (
                <button
                  key={`${route.file}-${route.path}`}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                    isHighlighted
                      ? 'bg-accent text-accent-foreground'
                      : 'text-secondary-foreground hover:bg-accent/70'
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commitRoute(route)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{route.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{normalizedPath}</div>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Current</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})
