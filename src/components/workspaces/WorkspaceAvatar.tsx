import {  } from "@heroicons/react/24/outline"
import type { ComponentType, SVGProps } from "react"
type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>

import { cn } from '@/lib/utils'
import { resolveWorkspaceIdentityPresentation, type WorkspaceIdentityRenderable } from '@/lib/workspaces/workspaceIdentity'

type WorkspaceAvatarSize = 'sm' | 'md' | 'lg'
type WorkspaceAvatarShape = 'rounded' | 'circle'

const SIZE_CLASS_MAP: Record<WorkspaceAvatarSize, string> = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
}

const ICON_CLASS_MAP: Record<WorkspaceAvatarSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
}

interface WorkspaceAvatarProps extends WorkspaceIdentityRenderable {
  className?: string
  size?: WorkspaceAvatarSize
  shape?: WorkspaceAvatarShape
  iconClassName?: string
  fallbackIcon?: LucideIcon
}

export function WorkspaceAvatar({
  workspaceType,
  iconKey,
  iconColor,
  logoUrl,
  className,
  size = 'md',
  shape = 'rounded',
  iconClassName,
  fallbackIcon,
}: WorkspaceAvatarProps) {
  const presentation = resolveWorkspaceIdentityPresentation({
    workspaceType,
    iconKey,
    iconColor,
    logoUrl,
  })
  const Icon = fallbackIcon ?? presentation.Icon

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-border/50',
        SIZE_CLASS_MAP[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-xl',
        presentation.color.avatarClassName,
        className,
      )}
      style={presentation.color.avatarStyle}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        <Icon
          className={cn(
            ICON_CLASS_MAP[size],
            presentation.color.iconClassName,
            iconClassName,
          )}
        />
      )}
    </div>
  )
}
