import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'

export interface ProjectCloudAccessPresentation {
  summary: string
  detail: string | null
  actionHref: string | null
  actionLabel: string | null
  isAccessError: boolean
}

interface ProjectCloudAccessPresentationOptions {
  workspaceScoped?: boolean
}

function extractErrorText(input: unknown, fallback: string): string {
  if (input instanceof Error) {
    return input.message || fallback
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }
  return fallback
}

function cleanGitTransportError(message: string): string {
  return message
    .replace(/^fatal:\s*/i, '')
    .replace(/^remote:\s*/i, '')
    .replace(/^error:\s*/i, '')
    .replace(/^\s*unable to access [^:]+:\s*/i, '')
    .trim()
}

export function formatProjectCloudAccessError(
  input: unknown,
  fallback = 'Failed to prepare project',
  options: ProjectCloudAccessPresentationOptions = {}
): ProjectCloudAccessPresentation {
  const rawMessage = extractErrorText(input, fallback)
  const normalized = cleanGitTransportError(rawMessage)
  const lower = normalized.toLowerCase()
  const billingHref =
    getSettingsSurfaceRoute('billing', options.workspaceScoped ? 'workspace' : 'personal') ??
    '/settings/billing'

  if (lower.includes('not a member of this project')) {
    return {
      summary: 'Project Access Required',
      detail: 'You do not currently have access to this project.',
      actionHref: null,
      actionLabel: null,
      isAccessError: true,
    }
  }

  if (lower.includes('past due')) {
    return {
      summary: 'Subscription Required',
      detail: 'Your subscription is past due. Update billing to restore cloud access.',
      actionHref: billingHref,
      actionLabel: 'Open Billing',
      isAccessError: true,
    }
  }

  if (lower.includes('subscription is canceled') || lower.includes('subscription is cancelled')) {
    return {
      summary: 'Subscription Required',
      detail: 'Your subscription is canceled. Start or renew a plan to restore cloud access.',
      actionHref: billingHref,
      actionLabel: 'Open Billing',
      isAccessError: true,
    }
  }

  if (lower.includes('not assigned to a paid seat')) {
    return {
      summary: 'Seat Assignment Required',
      detail: 'You are not assigned to a paid seat for cloud access in this workspace.',
      actionHref: billingHref,
      actionLabel: 'Open Billing',
      isAccessError: true,
    }
  }

  if (lower.includes('active paid seat assignment')) {
    return {
      summary: 'Seat Assignment Required',
      detail: 'Cloud access requires an active paid seat assignment in this workspace.',
      actionHref: billingHref,
      actionLabel: 'Open Billing',
      isAccessError: true,
    }
  }

  if (
    lower.includes('cloud sync is unavailable for this account') ||
    lower.includes('collaboration access requires an active subscription') ||
    lower.includes('sync access requires an active subscription') ||
    lower.includes('requested url returned error: 402')
  ) {
    return {
      summary: 'Subscription Required',
      detail: 'Cloud access requires an active subscription for this account.',
      actionHref: billingHref,
      actionLabel: 'Open Billing',
      isAccessError: true,
    }
  }

  return {
    summary: normalized || fallback,
    detail: null,
    actionHref: null,
    actionLabel: null,
    isAccessError: false,
  }
}
