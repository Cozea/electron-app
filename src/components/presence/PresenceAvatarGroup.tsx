const Shimmer = (props: any) => <div className={`animate-pulse bg-muted rounded ${props.className || 'h-full w-full'}`} />;
import type { PresenceUser } from "@/hooks/useProjectPresence"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { CodeBracketIcon as Code2, Cog6ToothIcon as Settings, DeviceTabletIcon as TabletSmartphone, DocumentTextIcon as FileCode2 } from "@heroicons/react/24/outline"
import { type CSSProperties, useMemo } from "react"
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
    pages: "Previews",
    settings: "Settings",
    deployments: "Deployments",
  }
  return names[tab] || "Project"
}

function getTabIcon(tab?: string) {
  switch (tab) {
    case "editor":
      return FileCode2
    case "pages":
      return TabletSmartphone
    case "settings":
      return Settings
    default:
      return Code2
  }
}

const AI_DOT_SHIMMER_STYLE: CSSProperties = {
  "--color-background": "var(--secondary-foreground)",
  "--color-muted-foreground": "color-mix(in srgb, var(--secondary-foreground) 45%, transparent)",
} as CSSProperties

function renderActivityBubble(user: PresenceUser) {
  const hasAiActivity = user.isAgentWorking || user.isAiTyping
  const hasHumanActivity = user.isMonacoTyping

  if (!hasAiActivity && !hasHumanActivity) {
    return null
  }

  if (hasAiActivity) {
    return (
      <span
        className="pointer-events-none absolute -bottom-2 left-1/2 flex h-4 min-w-7 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-secondary px-1 shadow-sm"
      >
        <span className="inline-flex h-full items-center justify-center leading-none" style={AI_DOT_SHIMMER_STYLE}>
          <Shimmer as="span" className="block text-[12px] font-semibold leading-none tracking-[-0.02em]">
            •••
          </Shimmer>
        </span>
      </span>
    )
  }

  return (
    <span
      className="pointer-events-none absolute -bottom-2 left-1/2 flex h-4 min-w-7 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-secondary px-1 shadow-sm text-secondary-foreground"
    >
      <div className="animate-spin bg-muted rounded-full h-4 w-4 border-t-2 border-foreground" />
    </span>
  )
}

export function PresenceAvatarGroup({
  users,
  maxVisible = 4,
  className,
  onUserClick,
}: PresenceAvatarGroupProps) {
  const sortedUsers = useMemo(() => {
    if (users.length === 0) return []

    // Keep single-collaborator positioning fully stable.
    if (users.length <= 1) return users

    return [...users].sort((a, b) => {
      const activityDelta =
        (b.lastActivityAt ?? b.lastHeartbeat) -
        (a.lastActivityAt ?? a.lastHeartbeat)
      if (activityDelta !== 0) return activityDelta

      // Deterministic tie-breaker prevents jitter when activity timestamps match.
      return a.userId.localeCompare(b.userId)
    })
  }, [users])
  if (sortedUsers.length === 0) return null

  const visibleUsers = sortedUsers.slice(0, maxVisible)
  const hiddenCount = Math.max(0, sortedUsers.length - maxVisible)

  return (
    <TooltipProvider>
      <div className={cn("flex items-center", className)}>
        <div className="flex -space-x-2">
          {visibleUsers.map((user, index) => {
            const color = getUserColor(user.userId)
            const TabIcon = getTabIcon(user.activeTab)
            return (
              <Tooltip key={user.userId}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onUserClick?.(user)}
                    className={cn(
                      "relative cursor-pointer transition-transform hover:scale-110 hover:z-10",
                      onUserClick && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-full"
                    )}
                    style={{ zIndex: visibleUsers.length - index }}
                    title={onUserClick ? "Open this user in Changes" : undefined}
                  >
                    <Avatar
                      className="h-6 w-6 border-2 border-border/70 bg-background"
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
                    {renderActivityBubble(user)}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                  <p className="font-medium">{user.userName}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TabIcon className="h-3 w-3 shrink-0" />
                    <span>{formatTabName(user.activeTab)}</span>
                  </div>
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
