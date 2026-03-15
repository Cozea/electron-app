import type { WorkspaceType } from './types'

export const WORKSPACE_ICON_KEYS = [
  'building-2',
  'briefcase',
  'sparkles',
  'rocket',
  'bell',
  'heart',
  'map',
  'camera',
  'message-square',
  'star',
  'package',
  'dollar-sign',
  'shield',
  'user',
] as const

export type WorkspaceIconKey = (typeof WORKSPACE_ICON_KEYS)[number]

export const WORKSPACE_ICON_COLOR_KEYS = [
  'default',
  'violet',
  'blue',
  'cyan',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'slate',
] as const

export type WorkspaceIconColorKey = (typeof WORKSPACE_ICON_COLOR_KEYS)[number]
export type WorkspaceIconColorValue = WorkspaceIconColorKey | `#${string}`

export interface WorkspaceIdentityFields {
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

export interface WorkspaceIdentityInput {
  iconKey?: WorkspaceIconKey
  iconColor?: WorkspaceIconColorValue
}

export interface WorkspaceIdentityUpdateInput {
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

export interface WorkspaceIdentitySubject extends WorkspaceIdentityFields {
  workspaceType?: WorkspaceType | null
}

const WORKSPACE_ICON_KEY_SET = new Set<string>(WORKSPACE_ICON_KEYS)
const WORKSPACE_ICON_COLOR_KEY_SET = new Set<string>(WORKSPACE_ICON_COLOR_KEYS)

export function isWorkspaceIconKey(value: string): value is WorkspaceIconKey {
  return WORKSPACE_ICON_KEY_SET.has(value)
}

export function isWorkspaceIconColorKey(value: string): value is WorkspaceIconColorKey {
  return WORKSPACE_ICON_COLOR_KEY_SET.has(value)
}

export function isWorkspaceCustomIconColor(value: string): value is `#${string}` {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

export function isWorkspaceIconColorValue(value: string): value is WorkspaceIconColorValue {
  return isWorkspaceIconColorKey(value) || isWorkspaceCustomIconColor(value)
}

export function sanitizeWorkspaceIdentityInput(
  input?: {
    iconKey?: string | null | undefined
    iconColor?: string | null | undefined
  } | null
): WorkspaceIdentityInput {
  const iconKey =
    typeof input?.iconKey === 'string' && isWorkspaceIconKey(input.iconKey)
      ? input.iconKey
      : undefined
  const iconColor =
    typeof input?.iconColor === 'string' &&
    isWorkspaceIconColorValue(input.iconColor)
      ? input.iconColor
      : undefined

  return {
    ...(iconKey ? { iconKey } : {}),
    ...(iconColor ? { iconColor } : {}),
  }
}

export function sanitizeWorkspaceIdentityUpdateInput(
  input?: {
    iconKey?: string | null | undefined
    iconColor?: string | null | undefined
    logoUrl?: string | null | undefined
  } | null
): WorkspaceIdentityUpdateInput {
  const hasExplicitIconKey = input ? 'iconKey' in input : false
  const hasExplicitIconColor = input ? 'iconColor' in input : false
  const hasExplicitLogoUrl = input ? 'logoUrl' in input : false

  const sanitizedIdentity = sanitizeWorkspaceIdentityInput(input)
  const rawLogoUrl = typeof input?.logoUrl === 'string' ? input.logoUrl.trim() : input?.logoUrl ?? undefined
  const logoUrl = rawLogoUrl ? rawLogoUrl : null

  const nextIconKey = hasExplicitIconKey ? sanitizedIdentity.iconKey ?? null : undefined
  const nextIconColor = hasExplicitIconColor
    ? sanitizedIdentity.iconColor ?? null
    : undefined

  return {
    ...(nextIconKey !== undefined ? { iconKey: nextIconKey } : {}),
    ...(nextIconColor !== undefined ? { iconColor: nextIconColor } : {}),
    ...(hasExplicitLogoUrl ? { logoUrl } : {}),
  }
}

export function getWorkspaceFallbackIconKey(
  workspaceType: WorkspaceType | null | undefined
): WorkspaceIconKey {
  return workspaceType === 'personal' ? 'user' : 'building-2'
}

export function resolveWorkspaceIdentity(subject?: WorkspaceIdentitySubject | null): WorkspaceIdentityInput {
  const sanitized = sanitizeWorkspaceIdentityInput(subject)
  const iconKey = sanitized.iconKey ?? getWorkspaceFallbackIconKey(subject?.workspaceType)

  return {
    iconKey,
    ...(sanitized.iconColor ? { iconColor: sanitized.iconColor } : {}),
  }
}
