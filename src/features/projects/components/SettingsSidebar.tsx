import * as React from "react"

import { NavUser } from "@/components/nav-user"
import {

  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import { resolveSettingsNavigationSections } from "@/lib/settings/settingsNavigation"
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from "@/features/projects/components/sidebar/projectSidebarShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon as __ArrowLeftHugeIcon } from '@hugeicons/core-free-icons'

interface SettingsSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
}

function toProjectsPath(path: string): string {
  return path.startsWith("/projects/") ? path : `/projects${path}`
}

/** Same `<button>` + classes as `ProjectSidebar` / project settings rows — not `SidebarMenuButton` */
function SettingsSidebarNavRow({
  isActive,
  onClick,
  icon: Icon,
  label,
}: {
  isActive: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(SIDEBAR_NAV_ROW_BUTTON_CLASS, isActive && SIDEBAR_PILL_ACTIVE_CLASS)}
      onClick={onClick}
    >
      <Icon />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function SettingsSidebar({ user, className, ...props }: SettingsSidebarProps) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const navSections = React.useMemo(
    () => resolveSettingsNavigationSections("sidebar"),
    [],
  )
  const sectionRoutes = navSections.flatMap((section) =>
    section.items.map((item) => toProjectsPath(item.route)),
  )

  const directSectionRoute = sectionRoutes.find((route) => route === location.pathname) ?? null
  const parentSectionRoute =
    sectionRoutes
      .filter((route) => location.pathname.startsWith(`${route}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  const isSubRoute = !directSectionRoute && Boolean(parentSectionRoute)

  return (
    <Sidebar
      collapsible="offcanvas"
      windowChromeAware
      windowChromeEndAddon={
        <SidebarTrigger
          className={cn(
            "h-7 w-7 shrink-0 rounded-md",
            "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground",
          )}
        />
      }
      rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
      className="h-full min-w-0 z-20 sidebar-glass"
      {...props}
    >
      <SidebarContent className="gap-0 px-2 py-3">
        <div className="mb-2">
          <button
            type="button"
            className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
            onClick={() => navigate("/projects")}
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
            <span className="truncate">Back to projects</span>
          </button>
        </div>

        {navSections.map((section, index) => (
          <SidebarGroup key={section.id} className={cn("px-0", index === 0 ? "py-0" : "py-2")}>
            <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>{section.label}</SidebarGroupLabel>
            <div className="space-y-1">
              {section.items.map((item) => {
                const href = toProjectsPath(item.route)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)

                return (
                  <SettingsSidebarNavRow
                    key={item.surface.id}
                    icon={item.surface.icon}
                    label={item.label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  />
                )
              })}
            </div>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        {isSubRoute && parentSectionRoute ? (
          <button
            type="button"
            className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
            onClick={() => navigate(parentSectionRoute)}
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
            <span className="truncate">Back</span>
          </button>
        ) : (
          <div>
            <NavUser user={user} />
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
