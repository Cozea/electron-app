import type { PresenceUser } from "@/hooks/useProjectPresence"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Bot, Code2, MessageSquareText } from "lucide-react"
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
  onUserClick?: (user: PresenceUser) => void
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
  onUserClick,
}: PresenceAvatarGroupProps) {
  if (users.length === 0) return null

  const sortedUsers = [...users].sort(
    (a, b) =>
      (b.lastActivityAt ?? b.lastHeartbeat) -
      (a.lastActivityAt ?? a.lastHeartbeat)
  )
  const visibleUsers = sortedUsers.slice(0, maxVisible)
  const hiddenCount = sortedUsers.length - maxVisible

  const getStatusPill = (user: PresenceUser) => {
    if (user.isAgentWorking) {
      return {
        label: "Agent",
        icon: Bot,
        className: "bg-violet-600/95 text-white",
      }
    }
    if (user.isAiTyping) {
      return {
        label: "AI",
        icon: MessageSquareText,
        className: "bg-amber-500/95 text-black",
      }
    }
    if (user.isMonacoTyping) {
      return {
        label: "Code",
        icon: Code2,
        className: "bg-sky-600/95 text-white",
      }
    }
    return null
  }

  return (
    <TooltipProvider>
      <div className={cn("flex items-center", className)}>
        <div className="flex -space-x-2">
          {visibleUsers.map((user, index) => {
            const color = getUserColor(user.userId)
            const statusPill = getStatusPill(user)
            return (
              <Tooltip key={user.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onUserClick?.(user)}
                    className={cn(
                      "relative cursor-pointer transition-transform hover:scale-110 hover:z-10",
                      onUserClick && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-full"
                    )}
                    style={{ zIndex: visibleUsers.length - index }}
                    title={onUserClick ? "Open this user in Sync Feed" : undefined}
                  >
                    <Avatar
                      className="h-6 w-6 border-2 border-background"
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
                    {statusPill && (
                      <span
                        className={cn(
                          "pointer-events-none absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-semibold leading-none shadow-sm",
                          statusPill.className
                        )}
                      >
                        <statusPill.icon className="h-2.5 w-2.5" />
                        {statusPill.label}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                  <p className="font-medium">{user.userName}</p>
                  <p className="text-xs text-muted-foreground">{user.userEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    Viewing: {formatTabName(user.activeTab)}
                  </p>
                  {user.isAgentWorking && (
                    <p className="text-xs text-muted-foreground">Agent: Working</p>
                  )}
                  {user.isAiTyping && (
                    <p className="text-xs text-muted-foreground">Typing in AI panel</p>
                  )}
                  {user.isMonacoTyping && (
                    <p className="text-xs text-muted-foreground">Typing in editor</p>
                  )}
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
