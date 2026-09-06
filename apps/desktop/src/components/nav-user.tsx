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
  | "account-settings"
  | NavUserThemeMenuAction
  | "theme-group"
  | "separator-top"
  | "separator-bottom"

// Transitional auth-session shape. The canonical display name/avatar are read
// from the authenticated device principal below; these fields are fallback-only
// until the session contract itself is renamed in the breaking cutover.
interface RawUser {
  email: string
  firstName?: string | null
  lastName?: string | null
  profileImageUrl?: string | null
}

interface FormattedUser {
  name: string
  email: string
  profileImageUrl?: string | null
}

function formatFallbackUser(
  user: RawUser | FormattedUser | null | undefined,
  fallbackLabel: string,
): FormattedUser {
  if (!user) return { name: fallbackLabel, email: "", profileImageUrl: null }
  if ("name" in user && typeof user.name === "string") return user

  const rawUser = user as RawUser
  const name = rawUser.firstName
    ? `${rawUser.firstName}${rawUser.lastName ? ` ${rawUser.lastName}` : ""}`
    : rawUser.email?.split("@")[0] || fallbackLabel

  return {
    name,
    email: rawUser.email || "",
    profileImageUrl: rawUser.profileImageUrl ?? null,
  }
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "D"
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "D"
}

export function NavUser({
  user,
}: {
  user: RawUser | FormattedUser | null | undefined
}) {
  const { theme, setTheme } = useTheme()
  const { convexUserId } = useAuth()
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()
  const fallback = formatFallbackUser(user, t("nav.thisComputer"))
  const principal = useQuery(api.users.getCurrent, convexUserId ? {} : "skip")

  const menuTitle = principal?.deviceLabel?.trim() || fallback.name || t("nav.thisComputer")
  const avatarUrl = principal?.profileImageUrl ?? fallback.profileImageUrl ?? null
  const menuSummarySublabel = t("nav.localComputer")

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

      if (action === "account-settings") {
        navigate("/projects/settings/account")
      }
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
          <Avatar className="size-5 shrink-0 rounded-md">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={menuTitle} /> : null}
            <AvatarFallback className="rounded-md text-[9px] font-medium">
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
