import {
  ChevronsUpDown,
  LogOut,
  Moon,
  Sun,
  Settings,
  Monitor,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSettingsDrawerStore } from "@/stores/useSettingsDrawerStore"
import { useTheme } from "@/contexts/ThemeContext"
import { cn } from "@/lib/utils"

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
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const userData = formatUserData(user)
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.open)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="rounded-2xl data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-full">
                <AvatarImage src={userData.avatar} alt={userData.name} />
                <AvatarFallback className="rounded-full">
                  {userData.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{userData.name}</span>
                <span className="truncate text-xs">{userData.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-2xl"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-full">
                  <AvatarImage src={userData.avatar} alt={userData.name} />
                  <AvatarFallback className="rounded-full">
                    {userData.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userData.name}</span>
                  <span className="truncate text-xs">{userData.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => openSettingsDrawer("account")}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-xs text-muted-foreground">
                Theme
              </DropdownMenuLabel>
              <div className="px-1 pb-1">
                <div className="grid grid-cols-3 gap-1 rounded-2xl bg-foreground/6 p-1">
                  <button
                    type="button"
                    aria-label="Light theme"
                    onClick={() => setTheme('light')}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-xl transition-colors",
                      theme === 'light'
                        ? "bg-foreground/14 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/10"
                    )}
                  >
                    <Sun className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Dark theme"
                    onClick={() => setTheme('dark')}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-xl transition-colors",
                      theme === 'dark'
                        ? "bg-foreground/14 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/10"
                    )}
                  >
                    <Moon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="System theme"
                    onClick={() => setTheme('system')}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-xl transition-colors",
                      theme === 'system'
                        ? "bg-foreground/14 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/10"
                    )}
                  >
                    <Monitor className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
