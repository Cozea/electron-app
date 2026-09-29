import * as React from "react"

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useNavigateTo, useViewTransitionNavigate } from "@/lib/navigation"
import { useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import { resolveSettingsNavigationSections } from "@/lib/settings/settingsNavigation"
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from "@/features/projects/ui/sidebar/projectSidebarShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon as __ArrowLeftHugeIcon } from '@hugeicons/core-free-icons'
import { useTranslation } from '@/lib/i18n'
import { getLastAppRoute } from "@/lib/settings/settingsReturnRoute"
import { GlideMenu } from "@/components/primitives/GlideMenu"
import { prewarmDestination } from "@/app/navigation/destinations"

/** Content-only: renders inside the persistent AppSidebarShell. */
interface SettingsSidebarProps {
  user?: {
    displayName?: string | null
    avatarUrl?: string | null
    identityKey?: string | null
  } | null
}

function toProjectsPath(path: string): string {
  return path.startsWith("/projects/") ? path : `/projects${path}`
}

/** Same `<button>` + classes as `ProjectSidebar` / project settings rows — not `SidebarMenuButton` */
function SettingsSidebarNavRow({
  isActive,
  onClick,
  onPrewarm,
  icon: Icon,
  label,
  dataTour,
}: {
  isActive: boolean
  onClick: () => void
  onPrewarm?: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  dataTour?: string
}) {
  return (
    <button
      type="button"
      data-row
      className={cn(
        SIDEBAR_NAV_ROW_BUTTON_CLASS,
        "relative z-10 px-1.5 hover:bg-transparent",
        isActive && cn(SIDEBAR_PILL_ACTIVE_CLASS, "group-hover/glide:bg-transparent"),
      )}
      data-tour={dataTour}
      onPointerEnter={onPrewarm}
      onFocus={onPrewarm}
      onClick={onClick}
    >
      <Icon />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function SettingsSidebar({ user }: SettingsSidebarProps) {
  const navigate = useViewTransitionNavigate()
  const navigateTo = useNavigateTo()
  const location = useLocation()
  const { t, language } = useTranslation()
  const navSections = React.useMemo(
    () => resolveSettingsNavigationSections("sidebar"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
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

  const handleBack = React.useCallback(() => {
    const returnTarget = getLastAppRoute(user?.identityKey)
    navigate(returnTarget)
  }, [navigate, user?.identityKey])

  return (
    <>
      <SidebarContent className="gap-0 px-2 py-3">
        <div className="mb-2">
          <button
            type="button"
            className={cn(
              SIDEBAR_NAV_ROW_BUTTON_CLASS,
              "transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
            )}
            data-tour="settings-back"
            onClick={handleBack}
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
            <span className="truncate">{t('common.back')}</span>
          </button>
        </div>

        <GlideMenu rowSelector="[data-row]">
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
                      // Matched on the route so the tour does not depend on a
                      // surface id it cannot see from here.
                      dataTour={href.endsWith("/organizations") ? "settings-organizations" : undefined}
                      onPrewarm={() => void prewarmDestination(href)}
                      onClick={() => navigateTo({ to: "settings", section: item.surface.id }, { replace: true })}
                    />
                  )
                })}
              </div>
            </SidebarGroup>
          ))}
        </GlideMenu>
      </SidebarContent>

      {isSubRoute && parentSectionRoute ? (
        <>
          <SidebarSeparator />
          <SidebarFooter className="gap-3 p-3">
            <button
              type="button"
              className={cn(
                SIDEBAR_NAV_ROW_BUTTON_CLASS,
                "transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
              )}
              onClick={() => navigate(parentSectionRoute)}
            >
              <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
              <span className="truncate">{t('common.back')}</span>
            </button>
          </SidebarFooter>
        </>
      ) : null}
    </>
  )
}
