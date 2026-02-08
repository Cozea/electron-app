import { useMemo } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export interface CompactPresenceUser {
  userId: string
  userName: string
  userAvatarUrl?: string
  lastActivityAt?: number
  lastHeartbeat: number
}

type IndicatorSize = "xs" | "sm"

interface CompactPresenceIndicatorProps {
  users: CompactPresenceUser[]
  size?: IndicatorSize
  className?: string
  showOverflow?: boolean
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
}

const sizeStyles: Record<
  IndicatorSize,
  {
    avatar: string
    text: string
    plusChip: string
  }
> = {
  xs: {
    avatar: "h-4 w-4",
    text: "text-[8px]",
    plusChip: "h-4 min-w-4 px-1 text-[8px]",
  },
  sm: {
    avatar: "h-5 w-5",
    text: "text-[9px]",
    plusChip: "h-5 min-w-5 px-1 text-[9px]",
  },
}

export function CompactPresenceIndicator({
  users,
  size = "xs",
  className,
  showOverflow = true,
}: CompactPresenceIndicatorProps) {
  const sortedUsers = useMemo(
    () =>
      [...users].sort(
        (a, b) =>
          (b.lastActivityAt ?? b.lastHeartbeat) -
          (a.lastActivityAt ?? a.lastHeartbeat)
      ),
    [users]
  )

  if (sortedUsers.length === 0) {
    return null
  }

  const primary = sortedUsers[0]
  const overflowCount = Math.max(0, sortedUsers.length - 1)
  const styles = sizeStyles[size]
  const tooltipNames = sortedUsers.map((user) => user.userName).join(", ")

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      title={tooltipNames}
      aria-label={`${sortedUsers.length} collaborator${sortedUsers.length === 1 ? "" : "s"} on this page`}
    >
      <Avatar className={cn("border border-background/70", styles.avatar)}>
        {primary.userAvatarUrl ? (
          <AvatarImage src={primary.userAvatarUrl} alt={primary.userName} />
        ) : null}
        <AvatarFallback className={cn("font-medium", styles.text)}>
          {getInitials(primary.userName)}
        </AvatarFallback>
      </Avatar>

      {showOverflow && overflowCount > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-background/90 font-semibold text-muted-foreground border border-border/70 tabular-nums",
            styles.plusChip
          )}
        >
          +{overflowCount}
        </span>
      )}
    </div>
  )
}
