import * as React from "react"

import { NavUser } from "@/components/nav-user"
import {

  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useTranslation } from "@/lib/i18n"
import { useSearchParams } from "@/lib/router"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  APP_STORE_CATEGORIES,
  resolveAppStoreCategory,
} from "@/features/projects/lib/appStoreCatalog"
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from "@/features/projects/components/sidebar/projectSidebarShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon as __ArrowLeftHugeIcon, Search01Icon as __SearchHugeIcon } from '@hugeicons/core-free-icons'

interface AppStoreSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
}

function AppStoreSidebarNavRow({
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

export function AppStoreSidebar({ user, className, ...props }: AppStoreSidebarProps) {
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get("q") ?? ""
  const activeCategory = resolveAppStoreCategory(searchParams.get("category"))

  const handleCategorySelect = React.useCallback(
    (categoryId: string) => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set("category", categoryId)
      setSearchParams(nextParams)
    },
    [searchParams, setSearchParams],
  )

  const handleQueryChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value
      const nextParams = new URLSearchParams(searchParams)
      if (nextQuery.trim()) {
        nextParams.set("q", nextQuery)
      } else {
        nextParams.delete("q")
      }
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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
      rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
      className="z-20 h-full min-w-0 sidebar-glass"
      {...props}
    >
      <SidebarHeader className="gap-3 px-3 pt-3 pb-2">
        <button
          type="button"
          className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
          onClick={() => navigate("/projects")}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          <span className="truncate">{t('projects.backToProjects')}</span>
        </button>

        <div className="relative">
          <HugeiconsIcon icon={__SearchHugeIcon} className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <SidebarInput
            type="search"
            value={query}
            onChange={handleQueryChange}
            placeholder={t('appStore.searchPlaceholder')}
            className="h-10 rounded-xl border-border/50 bg-muted pl-9 text-sm"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-1">
        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>{t('appStore.store')}</SidebarGroupLabel>
          <div className="space-y-1">
            {APP_STORE_CATEGORIES.map((category) => (
              <AppStoreSidebarNavRow
                key={category.id}
                icon={category.icon}
                label={(t as any)(`devApp.category.${category.id}`) ?? category.label}
                isActive={activeCategory.id === category.id}
                onClick={() => handleCategorySelect(category.id)}
              />
            ))}
          </div>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

