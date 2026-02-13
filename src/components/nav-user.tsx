import { Link } from "react-router-dom"
import {
  BadgeCheck,
  ChevronsUpDown,
  LogOut,
  Palette,
  HardDrive,
  Terminal,
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
  const userData = formatUserData(user)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
              <DropdownMenuItem asChild>
                <Link to="/settings/account">
                  <BadgeCheck className="mr-2 h-4 w-4" />
                  Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/appearance">
                  <Palette className="mr-2 h-4 w-4" />
                  Appearance
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/storage">
                  <HardDrive className="mr-2 h-4 w-4" />
                  Storage
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/tooling">
                  <Terminal className="mr-2 h-4 w-4" />
                  Tooling
                </Link>
              </DropdownMenuItem>
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
