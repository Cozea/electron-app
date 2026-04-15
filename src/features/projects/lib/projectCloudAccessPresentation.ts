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

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

export function formatProjectCloudAccessError(
  input: unknown,
  fallback = 'Failed to prepare project',
  options: ProjectCloudAccessPresentationOptions = {}
): ProjectCloudAccessPresentation {
  const rawMessage = extractErrorText(input, fallback)
  const normalized = cleanGitTransportError(rawMessage)
  const lower = normalized.toLowerCase()
  const storageHref = getSettingsSurfaceRoute('storage', 'personal') ?? '/settings/storage'
  const billingHref =
    getSettingsSurfaceRoute('billing', options.workspaceScoped ? 'workspace' : 'personal') ??
    '/settings/billing'
  const sourceControlHref =
    getSettingsSurfaceRoute('sourceControl', 'personal') ?? '/settings/source-control'

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

  if (
    includesAny(lower, [
      'failed to recover local project',
      'failed to clone project during recovery',
      'failed to move existing project aside for recovery',
      'failed to verify git status after automatic recovery',
      'local repository does not have work to replay',
      'you do not have the initial commit yet',
      'does not have the initial commit yet',
    ])
  ) {
    return {
      summary: 'Local Project Recovery Failed',
      detail:
        'This local copy is out of sync or incomplete. Delete the local copy from Storage and open the project again.',
      actionHref: storageHref,
      actionLabel: 'Open Storage',
      isAccessError: false,
    }
  }

  if (
    includesAny(lower, [
      'project path is not a git repository',
      'destination already exists and is not a git repository',
      'failed to initialize local git repository',
      'failed to read local git status',
      'failed to inspect local git repository health',
      'failed to verify git status after local project recovery',
      'failed to verify git status after restore',
      'failed to verify git status after pull',
      'failed to verify final git status',
    ])
  ) {
    return {
      summary: 'Local Project Copy Needs Repair',
      detail:
        'The local git data for this project looks incomplete or corrupted. Delete the local copy from Storage and reopen the project.',
      actionHref: storageHref,
      actionLabel: 'Open Storage',
      isAccessError: false,
    }
  }

  if (
    includesAny(lower, [
      'remote branch origin/',
      'remote branch ',
      'failed to restore missing remote history',
      'failed to prepare imported project for remote git',
      'failed to create initial project commit',
      'failed to publish project files to the remote',
      'failed to restore project files from the remote',
      'failed to refresh local project from the remote',
      'failed to replay local changes on top of remote history',
    ])
  ) {
    return {
      summary: 'Project History Is Not Ready',
      detail:
        'The project repository history is missing or could not be reconciled yet. Try again in a moment, or have a teammate open and sync the project first.',
      actionHref: null,
      actionLabel: null,
      isAccessError: false,
    }
  }

  if (
    includesAny(lower, [
      'repository access requires your github username',
      'repository access requires your provider identity',
      'repository access requires an email address on your account',
      'repository access must be resolved before this project can open',
      'repository access must be granted manually before this project can open',
    ])
  ) {
    return {
      summary: 'Repository Access Required',
      detail:
        normalized ||
        'This project cannot open until repository access is provisioned for your account.',
      actionHref: sourceControlHref,
      actionLabel: 'Open Git Providers',
      isAccessError: true,
    }
  }

  if (
    includesAny(lower, [
      'repository access is pending',
      'accept the provider invitation',
    ])
  ) {
    return {
      summary: 'Repository Access Pending',
      detail:
        normalized ||
        'Accept the repository invitation in your git provider, then reopen the project.',
      actionHref: sourceControlHref,
      actionLabel: 'Open Git Providers',
      isAccessError: true,
    }
  }

  if (
    includesAny(lower, [
      'failed to clone repository',
      'failed to fetch latest project changes',
      'authentication failed',
      'repository not found',
      'could not resolve host',
      'failed to connect',
      'connection timed out',
      'network is unreachable',
      'could not read from remote repository',
    ])
  ) {
    return {
      summary: 'Could Not Reach Project Repository',
      detail:
        'The app could not reach the project repository right now. Check your connection and try opening the project again.',
      actionHref: null,
      actionLabel: null,
      isAccessError: false,
    }
  }

  if (
    includesAny(lower, [
      'failed to publish local git changes',
    ])
  ) {
    return {
      summary: 'Repository Sync Failed',
      detail:
        'The project opened locally, but the app could not finish syncing its git history to the remote. Try again in a moment.',
      actionHref: null,
      actionLabel: null,
      isAccessError: false,
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
