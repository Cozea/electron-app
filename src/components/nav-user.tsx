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
import { useViewTransitionNavigate } from "@/lib/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon as __SettingsHugeIcon } from "@hugeicons/core-free-icons"

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
function formatUserData(user: RawUser | FormattedUser | null | undefined): FormattedUser {
  if (!user) {
    return { name: "This computer", email: "" }
  }

  // Check if already formatted (has 'name' property)
  if ('name' in user && typeof user.name === 'string') {
    return user as FormattedUser
  }

  // Format from raw user
  const rawUser = user as RawUser
  const name = rawUser.firstName
    ? `${rawUser.firstName}${rawUser.lastName ? ` ${rawUser.lastName}` : ""}`
    : rawUser.email?.split("@")[0] || "User"

  return {
    name,
    email: rawUser.email || "",
  }
}

function isLocalDeviceEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@local.cozea.app")
}

function formatLocalDeviceLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) {
    return "This computer"
  }

  // Hostnames can include local-domain suffixes we do not want in the sidebar.
  return trimmed.replace(/(\.localdomain|\.local)$/i, "") || "This computer"
}

export function NavUser({
  user,
  onLogout,
}: {
  user: RawUser | FormattedUser | null | undefined
  onLogout?: () => void
}) {
  const { theme, setTheme } = useTheme()
  const userData = formatUserData(user)
  const navigate = useViewTransitionNavigate()
  const { activeWorkspace: currentWorkspace } = useResolvedScope({ ignoreLocation: true })
  const isLocalDeviceProfile = isLocalDeviceEmail(userData.email)
  const menuTitle = isLocalDeviceProfile
    ? `This ${formatLocalDeviceLabel(userData.name)}`
    : userData.name
  const menuSummarySublabel = isLocalDeviceProfile
    ? "Local computer"
    : currentWorkspace?.organizationName || userData.email

  const handleMenuClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const items: ContextMenuItem<
        | "summary"
        | "account-settings"
        | "theme-light"
        | "theme-dark"
        | "theme-system"
        | "theme-group"
        | "logout"
        | "separator-top"
        | "separator-bottom"
      >[] = []

      if (menuTitle || menuSummarySublabel) {
        items.push({
          id: "summary",
          label: menuTitle || "User",
          sublabel: menuSummarySublabel || undefined,
          enabled: false,
        })
        items.push({ id: "separator-top", label: "", type: "separator" })
      }

      items.push({
        id: "account-settings",
        label: "User settings",
      })
      items.push({
        id: "theme-group",
        label: "Theme",
        submenu: [
          { id: "theme-light", label: "Light", type: "radio", checked: theme === "light" },
          { id: "theme-dark", label: "Dark", type: "radio", checked: theme === "dark" },
          { id: "theme-system", label: "System", type: "radio", checked: theme === "system" },
        ],
      })
      items.push({ id: "separator-bottom", label: "", type: "separator" })
      items.push({
        id: "logout",
        label: "Log out",
      })

      const position = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top),
      }

      const action = await showDesktopContextMenu(items, position)

      switch (action) {
        case "account-settings":
          navigate("/projects/settings/account")
          break
        case "theme-light":
          setTheme("light")
          break
        case "theme-dark":
          setTheme("dark")
          break
        case "theme-system":
          setTheme("system")
          break
        case "logout":
          onLogout?.()
          break
      }
    },
    [
      menuSummarySublabel,
      menuTitle,
      navigate,
      onLogout,
      setTheme,
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
          onClick={handleMenuClick}
          aria-label="Open user menu"
          title="Open user menu"
        >
          <HugeiconsIcon
            icon={__SettingsHugeIcon}
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="flex flex-1 items-center text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-normal text-sidebar-foreground">{menuTitle}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
