import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getDeviceInitials, getDeviceColor } from "@/lib/devicePresentation"
import { cn } from "@/lib/utils"

export interface DeviceAvatarProps {
  displayName?: string | null
  avatarUrl?: string | null
  principalId?: string | null
  className?: string
  fallbackClassName?: string
  fallbackLetter?: string
  useColor?: boolean
}

export function DeviceAvatar({
  displayName,
  avatarUrl,
  principalId,
  className,
  fallbackClassName,
  fallbackLetter = "D",
  useColor = true,
}: DeviceAvatarProps) {
  const initials = getDeviceInitials(displayName, fallbackLetter)
  const color = useColor && principalId ? getDeviceColor(principalId) : undefined

  return (
    <Avatar className={cn("size-7 rounded-lg", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName ?? "Device avatar"} /> : null}
      <AvatarFallback
        className={cn("text-xs font-medium", fallbackClassName)}
        style={color ? { backgroundColor: color, color: "white" } : undefined}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
