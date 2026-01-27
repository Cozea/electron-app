import type { PresenceUser } from "@/hooks/useProjectPresence"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface PresenceAvatarGroupProps {
  users: PresenceUser[]
  maxVisible?: number
  className?: string
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getUserColor(userId: string): string {
  // Generate a consistent color based on userId
  const colors = [
    "#ef4444", // red
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#14b8a6", // teal
    "#0ea5e9", // sky
    "#6366f1", // indigo
    "#a855f7", // purple
    "#ec4899", // pink
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function formatTabName(tab?: string): string {
  if (!tab) return "Project"
  const names: Record<string, string> = {
    editor: "Editor",
    pages: "Pages",
    backend: "Backend",
    settings: "Settings",
    dependencies: "Dependencies",
    deployments: "Deployments",
  }
  return names[tab] || "Project"
}

export function PresenceAvatarGroup({
  users,
  maxVisible = 4,
  className,
}: PresenceAvatarGroupProps) {
  if (users.length === 0) return null

  const visibleUsers = users.slice(0, maxVisible)
  const hiddenCount = users.length - maxVisible

  return (
    <TooltipProvider>
      <div className={cn("flex items-center", className)}>
        <div className="flex -space-x-2">
          {visibleUsers.map((user) => {
            const color = getUserColor(user.userId)
            return (
              <Tooltip key={user.id}>
                <TooltipTrigger asChild>
                  <Avatar
                    className="h-6 w-6 border-2 border-background cursor-pointer transition-transform hover:scale-110 hover:z-10"
                    style={{ borderColor: color }}
                  >
                    {user.userAvatarUrl ? (
                      <AvatarImage src={user.userAvatarUrl} alt={user.userName} />
                    ) : null}
                    <AvatarFallback
                      className="text-[10px] font-medium"
                      style={{ backgroundColor: color, color: "white" }}
                    >
                      {getInitials(user.userName)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                  <p className="font-medium">{user.userName}</p>
                  <p className="text-xs text-muted-foreground">{user.userEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    Viewing: {formatTabName(user.activeTab)}
                  </p>
                  {user.activeFile && (
                    <p className="text-xs text-muted-foreground">
                      File: {user.activeFile}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}

          {hiddenCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="h-6 w-6 border-2 border-background bg-muted cursor-pointer">
                  <AvatarFallback className="text-[10px] font-medium bg-muted text-muted-foreground">
                    +{hiddenCount}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {hiddenCount} more {hiddenCount === 1 ? "person" : "people"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
