import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage, type AvatarColor } from "@/components/ui/avatar";
import { getDeviceInitials, getDeviceColor } from "@/lib/devicePresentation";
import { cn } from "@/lib/utils";

export interface DeviceAvatarProps {
  displayName?: string | null;
  avatarUrl?: string | null;
  /** Principal used to derive the fallback color. Ignored unless `useColor` is true. */
  principalId?: string | null;
  /** Size and surface classes (e.g. `"size-6"`). Shape is always circular. */
  className?: string;
  /** Fallback text sizing (e.g. `"text-[10px] font-medium"`). */
  fallbackClassName?: string;
  fallbackLetter?: string;
  /** When true (default) and `principalId` is set, the fallback is the principal's color. Otherwise the neutral heroui gradient. */
  useColor?: boolean;
  /** Explicit heroui gradient when `useColor` is false. Defaults to the seeded gradient. */
  gradientColor?: AvatarColor;
  /** Overlap rings / speaking ring, e.g. `"border-2 border-background group-hover:border-accent"`. */
  ringClassName?: string;
  /** Corner status indicator (speaking dot, muted badge). Rendered inside the relative root. */
  statusIndicator?: ReactNode;
  /** When set (> 0), renders a muted "+N" circle instead of the identity. */
  overflowCount?: number;
}

/**
 * Single shared avatar surface. Shape is always circular; callers control
 * size, fallback text size, rings, and optional status/overflow adornments.
 */
export function DeviceAvatar({
  displayName,
  avatarUrl,
  principalId,
  className,
  fallbackClassName,
  fallbackLetter = "D",
  useColor = true,
  gradientColor,
  ringClassName,
  statusIndicator,
  overflowCount,
}: DeviceAvatarProps) {
  if (overflowCount !== undefined && overflowCount > 0) {
    return (
      <Avatar className={cn("rounded-full", className, ringClassName)}>
        <AvatarFallback className={cn("rounded-full text-muted-foreground", fallbackClassName)}>
          +{overflowCount}
        </AvatarFallback>
      </Avatar>
    );
  }

  const initials = getDeviceInitials(displayName, fallbackLetter);
  const color = useColor && principalId ? getDeviceColor(principalId) : undefined;

  return (
    <Avatar className={cn("rounded-full", className, ringClassName)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName ?? "Device avatar"} /> : null}
      <AvatarFallback
        className={cn("rounded-full", fallbackClassName)}
        color={gradientColor}
        style={color ? { backgroundColor: color, color: "white" } : undefined}
      >
        {initials}
      </AvatarFallback>
      {statusIndicator}
    </Avatar>
  );
}
