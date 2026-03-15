import type { CSSProperties } from 'react'
import {
  Bell,
  Briefcase,
  Building2,
  Camera,
  DollarSign,
  Heart,
  Map,
  MessageSquare,
  Package,
  Rocket,
  Shield,
  Sparkles,
  Star,
  User,
  type LucideIcon,
} from 'lucide-react'

import {
  WORKSPACE_ICON_COLOR_KEYS,
  WORKSPACE_ICON_KEYS,
  getWorkspaceFallbackIconKey,
  isWorkspaceCustomIconColor,
  resolveWorkspaceIdentity,
  type WorkspaceIconColorKey,
  type WorkspaceIconColorValue,
  type WorkspaceIconKey,
} from '@shared/workspaceIdentity.ts'

export interface WorkspaceIdentityRenderable {
  workspaceType?: 'personal' | 'organization' | null
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

interface WorkspaceColorOption {
  key: WorkspaceIconColorValue
  label: string
  swatchClassName: string
  avatarClassName: string
  selectedClassName: string
  swatchStyle?: CSSProperties
  avatarStyle?: CSSProperties
  iconClassName?: string
}

interface WorkspaceIconOption {
  key: WorkspaceIconKey
  label: string
  icon: LucideIcon
}

const WORKSPACE_ICON_MAP: Record<WorkspaceIconKey, LucideIcon> = {
  'building-2': Building2,
  briefcase: Briefcase,
  sparkles: Sparkles,
  rocket: Rocket,
  bell: Bell,
  heart: Heart,
  map: Map,
  camera: Camera,
  'message-square': MessageSquare,
  star: Star,
  package: Package,
  'dollar-sign': DollarSign,
  shield: Shield,
  user: User,
}

export const WORKSPACE_ICON_OPTIONS: WorkspaceIconOption[] = WORKSPACE_ICON_KEYS.map((key) => ({
  key,
  label: key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' '),
  icon: WORKSPACE_ICON_MAP[key],
}))

const WORKSPACE_COLOR_MAP: Record<WorkspaceIconColorKey, WorkspaceColorOption> = {
  default: {
    key: 'default',
    label: 'Default',
    swatchClassName: 'bg-black ring-border dark:bg-sidebar-accent',
    avatarClassName: 'bg-black text-white dark:bg-sidebar-accent dark:text-sidebar-accent-foreground',
    selectedClassName: 'ring-ring/60',
  },
  violet: {
    key: 'violet',
    label: 'Violet',
    swatchClassName: 'bg-violet-500 ring-violet-500/30',
    avatarClassName: 'bg-violet-500/15 text-violet-700 dark:bg-violet-400/20 dark:text-violet-200',
    selectedClassName: 'ring-violet-500/40',
  },
  blue: {
    key: 'blue',
    label: 'Blue',
    swatchClassName: 'bg-blue-500 ring-blue-500/30',
    avatarClassName: 'bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-200',
    selectedClassName: 'ring-blue-500/40',
  },
  cyan: {
    key: 'cyan',
    label: 'Cyan',
    swatchClassName: 'bg-cyan-500 ring-cyan-500/30',
    avatarClassName: 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/20 dark:text-cyan-100',
    selectedClassName: 'ring-cyan-500/40',
  },
  teal: {
    key: 'teal',
    label: 'Teal',
    swatchClassName: 'bg-teal-500 ring-teal-500/30',
    avatarClassName: 'bg-teal-500/15 text-teal-700 dark:bg-teal-400/20 dark:text-teal-100',
    selectedClassName: 'ring-teal-500/40',
  },
  green: {
    key: 'green',
    label: 'Green',
    swatchClassName: 'bg-emerald-500 ring-emerald-500/30',
    avatarClassName: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-100',
    selectedClassName: 'ring-emerald-500/40',
  },
  yellow: {
    key: 'yellow',
    label: 'Yellow',
    swatchClassName: 'bg-yellow-400 ring-yellow-400/30',
    avatarClassName: 'bg-yellow-400/20 text-yellow-700 dark:bg-yellow-300/20 dark:text-yellow-100',
    selectedClassName: 'ring-yellow-400/50',
  },
  orange: {
    key: 'orange',
    label: 'Orange',
    swatchClassName: 'bg-orange-500 ring-orange-500/30',
    avatarClassName: 'bg-orange-500/15 text-orange-700 dark:bg-orange-400/20 dark:text-orange-100',
    selectedClassName: 'ring-orange-500/40',
  },
  red: {
    key: 'red',
    label: 'Red',
    swatchClassName: 'bg-red-500 ring-red-500/30',
    avatarClassName: 'bg-red-500/15 text-red-700 dark:bg-red-400/20 dark:text-red-100',
    selectedClassName: 'ring-red-500/40',
  },
  pink: {
    key: 'pink',
    label: 'Pink',
    swatchClassName: 'bg-pink-500 ring-pink-500/30',
    avatarClassName: 'bg-pink-500/15 text-pink-700 dark:bg-pink-400/20 dark:text-pink-100',
    selectedClassName: 'ring-pink-500/40',
  },
  slate: {
    key: 'slate',
    label: 'Slate',
    swatchClassName: 'bg-slate-500 ring-slate-500/30',
    avatarClassName: 'bg-slate-500/15 text-slate-700 dark:bg-slate-400/20 dark:text-slate-100',
    selectedClassName: 'ring-slate-500/40',
  },
}

export const WORKSPACE_COLOR_OPTIONS: WorkspaceColorOption[] = WORKSPACE_ICON_COLOR_KEYS.map(
  (key) => WORKSPACE_COLOR_MAP[key]
)

export function getWorkspaceIconComponent(iconKey?: WorkspaceIconKey | null): LucideIcon {
  return WORKSPACE_ICON_MAP[iconKey ?? getWorkspaceFallbackIconKey('organization')]
}

export function getWorkspaceColorOption(
  colorKey?: WorkspaceIconColorValue | null
): WorkspaceColorOption {
  if (colorKey && isWorkspaceCustomIconColor(colorKey)) {
    return {
      key: colorKey,
      label: 'Custom',
      swatchClassName: 'ring-border/60',
      avatarClassName: '',
      selectedClassName: 'ring-ring/60',
      swatchStyle: { backgroundColor: colorKey },
      avatarStyle: {
        backgroundColor: `${colorKey}26`,
        color: colorKey,
      },
      iconClassName: 'text-[inherit]',
    }
  }
  return WORKSPACE_COLOR_MAP[colorKey ?? 'default']
}

export function resolveWorkspaceIdentityPresentation(workspace?: WorkspaceIdentityRenderable | null) {
  const resolvedIdentity = resolveWorkspaceIdentity(workspace)
  const iconKey = resolvedIdentity.iconKey ?? getWorkspaceFallbackIconKey(workspace?.workspaceType)
  const Icon = WORKSPACE_ICON_MAP[iconKey]
  const color = getWorkspaceColorOption(resolvedIdentity.iconColor)

  return {
    iconKey,
    iconColor: resolvedIdentity.iconColor ?? 'default',
    Icon,
    color,
  }
}
