import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useProductTourStore } from "@/features/tour/productTourStore"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useTranslation } from "@/lib/i18n"
import { prewarmDestination } from "@/app/navigation/destinations"

import {
  NAV_USER_THEME_OPTIONS,
  resolveNavUserThemeAction,
  type NavUserThemeMenuAction,
} from "./navUserThemeOptions"

type NavUserMenuAction =
  | "summary"
  | "device-settings"
  | NavUserThemeMenuAction
  | "theme-group"
  | "separator-top"
  | "separator-bottom"

import { getDeviceInitials as initials } from "@/lib/devicePresentation"

type DevicePresentation = {
  displayName?: string | null
  avatarUrl?: string | null
}

export function NavUser({ user: userProp }: { user?: DevicePresentation | null | undefined }) {
  const { theme, setTheme } = useTheme()
  const { user: authUser } = useAuth()
  const user = userProp ?? authUser
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()

  const menuTitle = user?.displayName?.trim() || t("nav.thisComputer")
  const avatarUrl = user?.avatarUrl ?? null
  const menuSummarySublabel = t("nav.localComputer")

  const isTourActive = useProductTourStore((state) => state.isActive)

  const handlePrewarmSettings = React.useCallback(() => {
    void prewarmDestination("/projects/settings/account")
    void import("@/features/settings/ui/SettingsSidebar")
    void import("@/features/settings/Account")
  }, [])

  const handleMenuClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      handlePrewarmSettings()
      const rect = event.currentTarget.getBoundingClientRect()
      const items: ContextMenuItem<NavUserMenuAction>[] = [
        {
          id: "summary",
          label: menuTitle,
          sublabel: menuSummarySublabel,
          enabled: false,
        },
        { id: "separator-top", label: "", type: "separator" },
        {
          id: "device-settings",
          label: t("nav.userSettings"),
          icon: getNativeMenuIcon("settings"),
        },
        {
          // The tutorial routes through settings. Changing theme mid-tour is
          // harmless but leads nowhere it can follow, so it waits its turn.
          id: "theme-group",
          label: t("nav.theme"),
          icon: getNativeMenuIcon("theme"),
          enabled: !isTourActive,
          submenu: NAV_USER_THEME_OPTIONS.map((option) => ({
            id: option.id,
            label: t(option.labelKey),
            type: "radio",
            checked: theme === option.theme,
          })),
        },
        { id: "separator-bottom", label: "", type: "separator" },
      ]

      const action = await showDesktopContextMenu(items, {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top),
      })
      const selectedTheme = resolveNavUserThemeAction(action)
      if (selectedTheme) {
        setTheme(selectedTheme)
        return
      }
      if (action === "device-settings") navigate("/projects/settings/account")
    },
    [isTourActive, menuSummarySublabel, menuTitle, navigate, setTheme, t, theme],
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          variant="pill"
          size="default"
          type="button"
          className="[&_svg]:text-sidebar-foreground"
          data-tour="user-menu"
          onPointerEnter={handlePrewarmSettings}
          onFocus={handlePrewarmSettings}
          onClick={handleMenuClick}
          aria-label={t("nav.openUserMenu")}
          title={t("nav.openUserMenu")}
        >
          <Avatar className="size-5 shrink-0 rounded-[5px]">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={menuTitle} /> : null}
            <AvatarFallback className="rounded-[5px] text-2xs font-bold leading-none">
              {initials(menuTitle)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 items-center text-left text-sm leading-none group-data-[collapsible=icon]:hidden">
            <span className="block w-full truncate font-normal leading-none text-sidebar-foreground">{menuTitle}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
