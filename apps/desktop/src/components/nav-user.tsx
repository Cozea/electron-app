import * as React from "react"
import { useQuery } from "convex/react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import { api } from "../../../../convex/_generated/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

type DevicePresentation = {
  displayName?: string | null
  avatarUrl?: string | null
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "D"
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "D"
}

export function NavUser({ user }: { user: DevicePresentation | null | undefined }) {
  const { theme, setTheme } = useTheme()
  const { principalId } = useAuth()
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()
  const principal = useQuery(api.devicePrincipals.getCurrent, principalId ? {} : "skip")

  const menuTitle = principal?.displayName?.trim() || user?.displayName?.trim() || t("nav.thisComputer")
  const avatarUrl = principal?.avatarUrl ?? user?.avatarUrl ?? null
  const menuSummarySublabel = t("nav.localComputer")

  const handleMenuClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
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
          id: "theme-group",
          label: t("nav.theme"),
          icon: getNativeMenuIcon("theme"),
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
    [menuSummarySublabel, menuTitle, navigate, setTheme, t, theme],
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          variant="pill"
          size="default"
          type="button"
          className="[&_svg]:text-sidebar-foreground"
          onClick={handleMenuClick}
          aria-label={t("nav.openUserMenu")}
          title={t("nav.openUserMenu")}
        >
          <Avatar className="size-5 shrink-0 rounded-[5px]">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={menuTitle} /> : null}
            <AvatarFallback className="rounded-[5px] text-[9px] font-bold">
              {initials(menuTitle)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 items-center text-left text-xs leading-none group-data-[collapsible=icon]:hidden">
            <span className="block w-full truncate font-normal leading-none text-sidebar-foreground">{menuTitle}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
