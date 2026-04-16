import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useTheme } from "@/contexts/ThemeContext"
import { useAuth } from "@/contexts/AuthContext"
import { useResolvedScope } from "@/hooks/useResolvedScope"
import { useCreateWorkspaceDialogStore } from "@/stores/useCreateWorkspaceDialogStore"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { useViewTransitionNavigate } from "@/lib/navigation"

// Raw user type from auth context
interface RawUser {
  email: string
  firstName?: string | null
  lastName?: string | null
  profileImageUrl?: string | null
}

// Formatted user type for display
interface FormattedUser {
  name: string
  email: string
  avatar: string
}

// Helper to format user data
function formatUserData(user: RawUser | FormattedUser | null | undefined): FormattedUser {
  if (!user) {
    return { name: "User", email: "", avatar: "" }
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
    avatar: rawUser.profileImageUrl || "",
  }
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
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore((state) => state.open)
  const navigate = useViewTransitionNavigate()
  const { organizationWorkspaces, personalWorkspace } = useAuth()
  const { activeWorkspace: currentWorkspace } = useResolvedScope({ ignoreLocation: true })
  const availableWorkspaceCount =
    organizationWorkspaces.length +
    (personalWorkspace || currentWorkspace?.workspaceType === "personal" ? 1 : 0)
  const menuSummarySublabel = currentWorkspace?.organizationName || userData.email

  const handleMenuClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const items: ContextMenuItem<
        | "summary"
        | "switch-workspace"
        | "create-workspace"
        | "account-settings"
        | "theme-light"
        | "theme-dark"
        | "theme-system"
        | "theme-group"
        | "logout"
        | "separator-top"
        | "separator-middle"
        | "separator-bottom"
      >[] = []

      if (userData.name || menuSummarySublabel) {
        items.push({
          id: "summary",
          label: userData.name || "User",
          sublabel: menuSummarySublabel || undefined,
          enabled: false,
        })
        items.push({ id: "separator-top", label: "", type: "separator" })
      }

      if (availableWorkspaceCount > 1) {
        items.push({
          id: "switch-workspace",
          label: "Switch Workspace",
        })
      }

      items.push({
        id: "create-workspace",
        label: "Create Workspace",
      })
      items.push({ id: "separator-middle", label: "", type: "separator" })
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
        case "switch-workspace":
          navigate("/workspaces/select")
          break
        case "create-workspace":
          openCreateWorkspaceDialog()
          break
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
      availableWorkspaceCount,
      menuSummarySublabel,
      navigate,
      onLogout,
      openCreateWorkspaceDialog,
      setTheme,
      theme,
      userData.email,
      userData.name,
    ],
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          type="button"
          onClick={handleMenuClick}
          aria-label="Open user menu"
          title="Open user menu"
          className="rounded-2xl hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)] active:bg-[var(--sidebar-pill-hover-bg)] active:text-[var(--sidebar-pill-hover-fg)]"
        >
          <Avatar className="h-6 w-6 rounded-full">
            <AvatarImage src={userData.avatar} alt={userData.name} />
            <AvatarFallback className="rounded-full">
              {userData.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-normal text-sidebar-foreground">{userData.name}</span>
            <span className="truncate font-normal text-muted-foreground">{activePlanLabel}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
