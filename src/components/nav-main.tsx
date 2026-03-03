import { memo, type ComponentType, type MouseEvent as ReactMouseEvent, useCallback, useRef } from "react"
import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { useSettingsDrawerStore } from "@/stores/useSettingsDrawerStore"

export interface NavMainItem {
  title: string
  url: string
  icon?: ComponentType<{ className?: string }>
  alpha?: boolean
  preload?: () => Promise<unknown>
  openInSettingsDrawer?: boolean
}

interface NavMainProps {
  label: string
  items: readonly NavMainItem[]
}

export const NavMain = memo(function NavMain({
  label,
  items,
}: NavMainProps) {
  const location = useLocation()
  const currentPath = location.pathname
  const preloadedUrlsRef = useRef<Set<string>>(new Set())
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)

  const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/"
  const normalizedCurrentPath = normalizePath(currentPath)

  const isItemActive = (item: NavMainItem) => {
    const normalizedItemPath = normalizePath(item.url)
    const matchesCurrentPath =
      normalizedCurrentPath === normalizedItemPath ||
      normalizedCurrentPath.startsWith(`${normalizedItemPath}/`)

    if (!matchesCurrentPath) return false

    // When multiple items match by prefix, keep only the most specific one active.
    const hasMoreSpecificMatch = items.some((candidate) => {
      if (candidate.url === item.url) return false
      const normalizedCandidatePath = normalizePath(candidate.url)
      const candidateMatches =
        normalizedCurrentPath === normalizedCandidatePath ||
        normalizedCurrentPath.startsWith(`${normalizedCandidatePath}/`)

      return candidateMatches && normalizedCandidatePath.length > normalizedItemPath.length
    })

    return !hasMoreSpecificMatch
  }

  const preloadItem = useCallback((item: NavMainItem) => {
    if (!item.preload) return
    if (preloadedUrlsRef.current.has(item.url)) return
    preloadedUrlsRef.current.add(item.url)
    void item.preload().catch(() => {
      preloadedUrlsRef.current.delete(item.url)
    })
  }, [])

  const handleItemClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>, item: NavMainItem) => {
    if (!item.openInSettingsDrawer) return
    event.preventDefault()
    openSettingsDrawer(item.url)
  }, [openSettingsDrawer])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={isItemActive(item)}
              asChild
            >
              <Link
                to={item.url}
                onClick={(event) => handleItemClick(event, item)}
                onMouseEnter={() => preloadItem(item)}
                onFocus={() => preloadItem(item)}
                onPointerDown={() => preloadItem(item)}
              >
                {item.icon && <item.icon className="opacity-60" />}
                <span>{item.title}</span>
                {item.alpha && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 font-normal">
                    alpha
                  </Badge>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
})

NavMain.displayName = "NavMain"
