import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useTheme } from "@/contexts/ThemeContext"
import { useResolvedScope } from "@/hooks/useResolvedScope"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useTranslation } from "@/lib/i18n"
import { formatLocalDeviceLabel, isLocalDeviceEmail } from "@/lib/userDisplay"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon as __SettingsHugeIcon } from "@hugeicons/core-free-icons"

import {
  NAV_USER_THEME_OPTIONS,
  resolveNavUserThemeAction,
  type NavUserThemeMenuAction,
} from "./navUserThemeOptions"

type NavUserMenuAction =
  | "summary"
  | "account-settings"
  | NavUserThemeMenuAction
  | "theme-group"
  | "separator-top"
  | "separator-bottom"

// Raw user type from auth context
interface RawUser {
  email: string
  firstName?: string | null
  lastName?: string | null
}

// Formatted user type for display
interface FormattedUser {
  name: string
  email: string
}

// Helper to format user data
function formatUserData(user: RawUser | FormattedUser | null | undefined, fallbackLabel: string): FormattedUser {
  if (!user) {
    return { name: fallbackLabel, email: "" }
  }

  // Check if already formatted (has 'name' property)
  if ('name' in user && typeof user.name === 'string') {
    return user as FormattedUser
  }

  // Format from raw user
  const rawUser = user as RawUser
  const name = rawUser.firstName
    ? `${rawUser.firstName}${rawUser.lastName ? ` ${rawUser.lastName}` : ""}`
    : rawUser.email?.split("@")[0] || ""

  return {
    name,
    email: rawUser.email || "",
  }
}

export function NavUser({
  user,
}: {
  user: RawUser | FormattedUser | null | undefined
}) {
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation()
  const userData = formatUserData(user, t("nav.thisComputer"))
  const navigate = useViewTransitionNavigate()
  const { activeWorkspace: currentWorkspace } = useResolvedScope({ ignoreLocation: true })
  const isLocalDeviceProfile = isLocalDeviceEmail(userData.email)
  const menuTitleFallback = userData.name || t("common.user")
  const formattedDeviceName = formatLocalDeviceLabel(menuTitleFallback)
  const menuTitle = isLocalDeviceProfile
    ? formattedDeviceName ? t("nav.thisDevice").replace("{device}", formattedDeviceName) : t("nav.thisComputer")
    : userData.name
  const menuSummarySublabel = isLocalDeviceProfile
    ? t("nav.localComputer")
    : currentWorkspace?.workspaceName || currentWorkspace?.organizationName || userData.email

  const handleMenuClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const items: ContextMenuItem<NavUserMenuAction>[] = []

      if (menuTitle || menuSummarySublabel) {
        items.push({
          id: "summary",
          label: menuTitle,
          sublabel: menuSummarySublabel || undefined,
          enabled: false,
        })
        items.push({ id: "separator-top", label: "", type: "separator" })
      }

      items.push({
        id: "account-settings",
        label: t("nav.userSettings"),
        icon: getNativeMenuIcon("settings"),
      })
      items.push({
        id: "theme-group",
        label: t("nav.theme"),
        icon: getNativeMenuIcon("theme"),
        submenu: NAV_USER_THEME_OPTIONS.map((option) => ({
          id: option.id,
          label: t(option.labelKey),
          type: "radio",
          checked: theme === option.theme,
        })),
      })
      items.push({ id: "separator-bottom", label: "", type: "separator" })

      const position = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top),
      }

      const action = await showDesktopContextMenu(items, position)
      const selectedTheme = resolveNavUserThemeAction(action)

      if (selectedTheme) {
        setTheme(selectedTheme)
        return
      }

      switch (action) {
        case "account-settings":
          navigate("/projects/settings/account")
          break
      }
    },
    [
      menuSummarySublabel,
      menuTitle,
      navigate,
      setTheme,
      t,
      theme,
    ],
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
          <HugeiconsIcon
            icon={__SettingsHugeIcon}
            className="size-3.5 shrink-0 text-sidebar-foreground"
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 items-center text-left text-xs leading-none group-data-[collapsible=icon]:hidden">
            <span className="block w-full truncate font-normal leading-none text-sidebar-foreground">{menuTitle}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
