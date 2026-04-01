import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { isGitOpenDebugEnabled, logGitOpenDebug } from '@/lib/git/gitOpenDebug'
import { recordGitOpenTelemetry, type GitOpenTelemetryEvent } from '@/lib/git/gitOpenTelemetry'
import { syncProjectRepositoryAccess } from '@/lib/git/projectRepoAutomation'
import {
  resolveProjectIntegrationProvider,
  resolveProjectRepoAccessStatus,
} from '@/lib/git/projectRepoAccess'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'
import {
  resolveEffectiveProjectGitBranch,
  resolveProjectGitRemoteConfig,
  resolveProjectGitSyncPolicy,
  resolveProjectWorkingCopyMode,
  type ProjectGitRuntimeSourceControlLike,
} from '@/lib/git/projectGitRuntime'

export interface GitRepositoryMetadataLike {
  provider?: string
  url?: string
  defaultBranch?: string | null
}

export interface ProjectOpenGitProjectLike {
  _id: Id<'projects'>
  name?: string | null
  slug: string
  organizationId: Id<'organizations'>
  createdBy?: Id<'users'> | string | null
  syncMode?: 'git'
  localPath?: string | null
  gitRepository?: GitRepositoryMetadataLike | null
  sourceControl?: ProjectGitRuntimeSourceControlLike | null
}

export interface PrepareGitProjectForOpenOptions {
  convex: ConvexReactClient
  project: ProjectOpenGitProjectLike
  localPath: string | null
  userId: Id<'users'> | null | undefined
  onProgress?: (message: string) => void
  updateMemberLocalPath?: (args: {
    projectId: Id<'projects'>
    userId: Id<'users'>
    localPath: string
  }) => Promise<unknown>
}

export interface PrepareGitProjectForOpenResult {
  localPath: string
  skipInitialSyncCheck: boolean
  changed: boolean
  currentBranch?: string
  cancelled?: boolean
  needsConflictResolution?: boolean
  conflictedPaths?: string[]
}

function shouldAdoptWorkspaceForMissingRemote(project: ProjectOpenGitProjectLike): boolean {
  return resolveProjectWorkingCopyMode(project.sourceControl) === 'attached'
}

async function resolveTargetProjectPath(project: Pick<ProjectOpenGitProjectLike, '_id' | 'slug'>): Promise<string> {
  const resolvedExistingPath = await window.electronAPI.project.getLocalPath({
    slug: project.slug,
    projectId: String(project._id),
  })
  if (resolvedExistingPath) {
    return resolvedExistingPath
  }

  const settings = await window.electronAPI.settings.get()
  return `${settings.projectsDirectory.replace(/\/+$/, '')}/${project.slug}`
}

async function rememberProjectOpenPath(projectId: string, localPath: string): Promise<void> {
  const result = await window.electronAPI.project.rememberLocalPath({
    projectId,
    projectPath: localPath,
  })

  if (!result.success) {
    console.warn('[GitOpen] Failed to persist local project path:', result.error)
  }
}

async function isEffectivelyEmptyLocalWorkspace(projectPath: string): Promise<boolean> {
  const listResult = await window.electronAPI.project.listFiles({ projectPath })
  logGitOpenDebug('empty_check:list_result', {
    projectPath,
    success: listResult.success,
    fileCount: listResult.files?.length ?? null,
    fileSample: (listResult.files ?? []).slice(0, 20).map((file) => file.path),
  })
  if (!listResult.success) {
    return false
  }
  const meaningfulFiles = (listResult.files ?? []).filter((file) => {
    const normalizedPath = file.path.replace(/\\/g, '/')
    return normalizedPath !== '.gitignore' && normalizedPath !== '.env.example'
  })
  logGitOpenDebug('empty_check:meaningful_files', {
    projectPath,
    meaningfulFileCount: meaningfulFiles.length,
    meaningfulFileSample: meaningfulFiles.slice(0, 20).map((file) => file.path),
  })
  return meaningfulFiles.length === 0
}

function shouldTreatAsSuspectedLocalWipe(status: {
  deletedCount?: number
  changedPaths?: string[]
  hasUntrackedChanges?: boolean
}): boolean {
  const deletedCount = status.deletedCount ?? 0
  const changedCount = status.changedPaths?.length ?? 0
  const nonDeletedCount = Math.max(0, changedCount - deletedCount)

  if (deletedCount === 0 || status.hasUntrackedChanges) {
    return false
  }

  return deletedCount >= 5 && changedCount > 0 && nonDeletedCount <= 2
}

function isRecoverableInitialCommitStateError(errorMessage: string): boolean {
  const normalized = errorMessage.trim().toLowerCase()
  return (
    normalized.includes('you do not have the initial commit yet') ||
    normalized.includes('does not have the initial commit yet') ||
    normalized.includes('local repository does not have work to replay')
  )
}

function formatConflictFileList(paths: string[] | undefined, maxItems = 5): string {
  const conflictedPaths = (paths ?? []).filter(Boolean)
  if (conflictedPaths.length === 0) {
    return 'Resolve the merge in your editor before opening the project again.'
  }

  const visiblePaths = conflictedPaths.slice(0, maxItems)
  const remainingCount = conflictedPaths.length - visiblePaths.length
  const fileList = visiblePaths.map((filePath) => `• ${filePath}`).join('\n')
  const remainder =
    remainingCount > 0
      ? `\n+${remainingCount} more conflicted file${remainingCount === 1 ? '' : 's'}`
      : ''

  return `These files need a merge resolution first:\n${fileList}${remainder}`
}

async function promptForGitConflicts(args: {
  projectName: string
  projectPath: string
  conflictedPaths?: string[]
}): Promise<'later' | 'open-folder' | 'resolve-now'> {
  const result = await window.electronAPI.dialog.showMessageBox({
    type: 'warning',
    buttons: ['Later', 'Open Folder', 'Resolve Now'],
    defaultId: 2,
    cancelId: 0,
    title: 'Resolve conflicts first',
    message: `${args.projectName} has files changed in both places.`,
    detail: formatConflictFileList(args.conflictedPaths),
    noLink: true,
  })

  if (result.response === 2) {
    return 'resolve-now'
  }

  if (result.response !== 1) {
    return 'later'
  }

  const openFolderResult = await window.electronAPI.project.openFolder({
    projectPath: args.projectPath,
  })
  if (!openFolderResult.success) {
    throw new Error(openFolderResult.error || 'Failed to open project folder')
  }

  return 'open-folder'
}

async function promptForMissingProjectSourceControl(args: {
  provider: 'github' | 'gitlab'
  projectName: string
  settingsScope: 'user' | 'workspace'
  detail: string
}): Promise<'later' | 'open-settings'> {
  const providerLabel = args.provider === 'github' ? 'GitHub' : 'GitLab'
  const result = await window.electronAPI.dialog.showMessageBox({
    type: 'warning',
    buttons: ['Later', 'Open Source Control'],
    defaultId: 1,
    cancelId: 0,
    title: `${providerLabel} setup needed`,
    message: `Set up ${providerLabel} before opening ${args.projectName}.`,
    detail: args.detail,
    noLink: true,
  })

  if (result.response !== 1) {
    return 'later'
  }

  const settingsRoute =
    args.settingsScope === 'workspace'
      ? '/workspace/source-control'
      : '/settings/source-control'
  const openResult = await window.electronAPI.window.openSettings(settingsRoute)
  if (!openResult?.success) {
    throw new Error(openResult?.error || 'Failed to open Source Control settings')
  }

  return 'open-settings'
}

async function ensureProjectSourceControlReadyForOpen(args: {
  convex: ConvexReactClient
  project: ProjectOpenGitProjectLike
  userId: Id<'users'>
}): Promise<boolean> {
  const provider = resolveProjectIntegrationProvider(args.project)
  const workingCopyMode = resolveProjectWorkingCopyMode(args.project.sourceControl)
  const repoUrl =
    args.project.gitRepository?.url?.trim() ||
    args.project.sourceControl?.repoUrl?.trim() ||
    ''

  if (!provider || workingCopyMode === 'attached' || !repoUrl) {
    return true
  }

  const providerContext = await args.convex.query(
    api.sourceControl.getProjectProviderContext,
    {
      projectId: args.project._id,
      userId: args.userId,
    }
  )

  const repoAccessStatus = resolveProjectRepoAccessStatus({
    project: args.project,
    sourceControlConnection: providerContext?.connection ?? null,
    isPersonalWorkspace: providerContext?.isPersonalWorkspace,
  })

  if (
    repoAccessStatus.state !== 'integration_missing' &&
    repoAccessStatus.state !== 'integration_mismatch'
  ) {
    return true
  }

  const projectName = args.project.name?.trim() || args.project.slug
  await promptForMissingProjectSourceControl({
    provider,
    projectName,
    settingsScope: providerContext?.settingsScope === 'workspace' ? 'workspace' : 'user',
    detail: repoAccessStatus.description,
  })

  return false
}

async function ensureProjectRepositoryAccessForOpen(args: {
  convex: ConvexReactClient
  project: ProjectOpenGitProjectLike
  userId: Id<'users'>
}): Promise<boolean> {
  const provider =
    args.project.gitRepository?.provider?.trim().toLowerCase() ??
    args.project.sourceControl?.provider?.trim().toLowerCase()
  const workingCopyMode = resolveProjectWorkingCopyMode(args.project.sourceControl)
  const repoUrl =
    args.project.gitRepository?.url?.trim() ||
    args.project.sourceControl?.repoUrl?.trim() ||
    ''

  if (
    workingCopyMode === 'attached' ||
    !repoUrl ||
    (provider !== 'github' && provider !== 'gitlab')
  ) {
    return true
  }

  if (args.project.createdBy === args.userId) {
    return true
  }

  const [user, memberRole, repoAccessRows] = await Promise.all([
    args.convex.query(api.users.getById, {
      userId: args.userId,
    }),
    args.convex.query(api.projectMembers.getMemberRole, {
      projectId: args.project._id,
      userId: args.userId,
    }),
    args.convex.query(api.projectRepoAccess.listForProject, {
      projectId: args.project._id,
      viewerUserId: args.userId,
    }),
  ])

  const normalizedEmail = user?.email?.trim().toLowerCase() || undefined
  const currentRole =
    memberRole === 'project_manager' ||
    memberRole === 'developer' ||
    memberRole === 'designer' ||
    memberRole === 'viewer'
      ? memberRole
      : 'viewer'
  const existingRepoAccess =
    repoAccessRows.find((entry) => entry.memberUserId === args.userId) ??
    (normalizedEmail
      ? repoAccessRows.find((entry) => entry.inviteEmail === normalizedEmail)
      : undefined)

  if (
    existingRepoAccess?.accessState === 'granted' &&
    existingRepoAccess.role === currentRole
  ) {
    return true
  }

  let providerAccountHandle = existingRepoAccess?.providerAccountHandle

  if (provider === 'github' && !providerAccountHandle) {
    const providedHandle = window.prompt(
      'Enter your GitHub username to grant repository access for this project.'
    )
    if (!providedHandle?.trim()) {
      return false
    }
    providerAccountHandle = providedHandle.trim()
  }

  if (provider === 'gitlab' && !normalizedEmail) {
    throw new Error(
      'Repository access requires an email address on your account before this project can open.'
    )
  }

  const outcome = await syncProjectRepositoryAccess({
    convex: args.convex,
    project: args.project,
    actorUserId: args.userId,
    subjectType: 'member',
    memberUserId: args.userId,
    inviteEmail: normalizedEmail,
    providerAccountHandle,
    role: currentRole,
    action: 'grant',
    isPersonalWorkspace: args.project.sourceControl?.setupMode !== 'organization',
  })

  if (outcome.accessState === 'granted') {
    return true
  }

  if (outcome.accessState === 'pending') {
    throw new Error(
      outcome.error ||
        'Repository access is pending. Accept the provider invitation, then reopen this project.'
    )
  }

  if (outcome.accessState === 'needs_identity') {
    throw new Error(
      outcome.error ||
        'Repository access requires your provider identity before this project can open.'
    )
  }

  throw new Error(
    outcome.error || 'Repository access must be resolved before this project can open.'
  )
}

export async function prepareGitProjectForOpen({
  convex,
  project,
  localPath,
  userId,
  onProgress,
  updateMemberLocalPath,
}: PrepareGitProjectForOpenOptions): Promise<PrepareGitProjectForOpenResult> {
  const remoteConfig = await resolveProjectGitRemoteConfig({
    convex,
    project,
    userId,
  })
  const {
    branch: configuredBranch,
    repoUrl,
    provider,
    accessToken,
    usesExistingRemote,
  } = remoteConfig
  const hasRemote = Boolean(repoUrl || usesExistingRemote)
  const debug = isGitOpenDebugEnabled()
  let effectiveLocalPath = localPath ?? (await resolveTargetProjectPath(project))
  let branch = configuredBranch
  let changed = false
  const startedAt = Date.now()
  let strategy: GitOpenTelemetryEvent['strategy'] = 'clean'
  let lastRepoHealth: string | undefined
  let hadMeaningfulLocalState = false
  let attemptedInitialCommitRecovery = false

  const recordOutcome = (
    outcome: GitOpenTelemetryEvent['outcome'],
    overrides?: Partial<GitOpenTelemetryEvent>
  ): void => {
    recordGitOpenTelemetry({
      at: new Date().toISOString(),
      projectId: String(project._id),
      projectSlug: project.slug,
      outcome,
      durationMs: Date.now() - startedAt,
      strategy,
      changed,
      repoHealth: lastRepoHealth,
      hadMeaningfulLocalState,
      ...overrides,
    })
  }

  const finalizeProjectOpenResult = async (
    result: PrepareGitProjectForOpenResult
  ): Promise<PrepareGitProjectForOpenResult> => {
    await rememberProjectOpenPath(String(project._id), result.localPath)

    if (userId && updateMemberLocalPath) {
      try {
        await updateMemberLocalPath({
          projectId: project._id,
          userId,
          localPath: result.localPath,
        })
      } catch (error) {
        console.warn('[GitOpen] Failed to mirror local project path to cloud metadata:', error)
      }
    }

    return result
  }

  logGitOpenDebug('prepare:start', {
    projectId: String(project._id),
    projectSlug: project.slug,
    branch: configuredBranch,
    repoUrl,
    providedLocalPath: localPath ?? null,
    effectiveLocalPath,
    provider: provider ?? null,
    hasRemote,
  })

  try {
    if (hasRemote && localPath) {
      branch = await resolveEffectiveProjectGitBranch({
        projectPath: effectiveLocalPath,
        fallbackBranch: configuredBranch,
        usesExistingRemote,
      })
    }

    if (userId) {
      onProgress?.('Checking source control setup...')
      const sourceControlReady = await ensureProjectSourceControlReadyForOpen({
        convex,
        project,
        userId,
      })
      if (!sourceControlReady) {
        const result: PrepareGitProjectForOpenResult = {
          localPath: effectiveLocalPath,
          skipInitialSyncCheck: true,
          changed,
          cancelled: true,
        }
        recordOutcome('cancelled')
        return finalizeProjectOpenResult(result)
      }

      onProgress?.('Checking repository access...')
      const repositoryAccessReady = await ensureProjectRepositoryAccessForOpen({
        convex,
        project,
        userId,
      })
      if (!repositoryAccessReady) {
        const result: PrepareGitProjectForOpenResult = {
          localPath: effectiveLocalPath,
          skipInitialSyncCheck: true,
          changed,
          cancelled: true,
        }
        recordOutcome('cancelled')
        return finalizeProjectOpenResult(result)
      }
    }

    if (!localPath) {
      if (!repoUrl) {
        throw new Error('This project has no configured remote repository yet.')
      }
      onProgress?.('Cloning repository...')
      const cloneResult = await window.electronAPI.sync.gitCloneIfMissing({
        projectPath: effectiveLocalPath,
        repoUrl,
        branch,
        provider,
        accessToken,
        debug,
      })
      logGitOpenDebug('prepare:clone_result', {
        projectId: String(project._id),
        effectiveLocalPath,
        cloneResult,
      })
      if (!cloneResult.success || !cloneResult.localPath) {
        throw new Error(cloneResult.error || 'Failed to clone repository')
      }
      effectiveLocalPath = cloneResult.localPath
      changed = true

    } else {
      onProgress?.('Checking git repository...')
      const ensureResult = await window.electronAPI.sync.gitEnsureRepo({
        projectPath: effectiveLocalPath,
        branch,
        repoUrl,
        debug,
      })
      logGitOpenDebug('prepare:ensure_result', {
        projectId: String(project._id),
        effectiveLocalPath,
        ensureResult,
      })
      if (!ensureResult.success) {
        throw new Error(ensureResult.error || 'Failed to initialize local git repository')
      }
      changed = changed || Boolean(ensureResult.initialized)
    }

    if (!hasRemote) {
      const localStatus = await window.electronAPI.sync.gitStatus({
        projectPath: effectiveLocalPath,
        branch,
        debug,
      })
      if (!localStatus.success || !localStatus.isRepo) {
        throw new Error(localStatus.error || 'Failed to verify local git repository')
      }

      const result: PrepareGitProjectForOpenResult = {
        localPath: effectiveLocalPath,
        skipInitialSyncCheck: true,
        changed,
        currentBranch: localStatus.currentBranch ?? undefined,
      }
      recordOutcome('opened')
      return finalizeProjectOpenResult(result)
    }

    if (resolveProjectGitSyncPolicy(project.sourceControl) === 'manual') {
      const localStatus = await window.electronAPI.sync.gitStatus({
        projectPath: effectiveLocalPath,
        branch,
        debug,
      })
      if (!localStatus.success || !localStatus.isRepo) {
        throw new Error(localStatus.error || 'Failed to verify local git repository')
      }

      const result: PrepareGitProjectForOpenResult = {
        localPath: effectiveLocalPath,
        skipInitialSyncCheck: true,
        changed,
        currentBranch: localStatus.currentBranch ?? undefined,
      }
      recordOutcome('opened')
      return finalizeProjectOpenResult(result)
    }

    onProgress?.('Fetching latest changes...')
    const fetchResult = await window.electronAPI.sync.gitFetchMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      provider,
      accessToken,
      debug,
    })
  logGitOpenDebug('prepare:fetch_result', {
    projectId: String(project._id),
    effectiveLocalPath,
    fetchResult,
  })
  if (!fetchResult.success) {
    throw new Error(fetchResult.error || 'Failed to fetch latest project changes')
  }
  let remoteHeadCommit = fetchResult.headCommit ?? null

  let status = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
    debug,
  })
  logGitOpenDebug('prepare:initial_status', {
    projectId: String(project._id),
    effectiveLocalPath,
    status,
  })
  if (!status.success || !status.isRepo) {
    throw new Error(status.error || 'Failed to read local git status')
  }

  const attemptInitialCommitRecovery = async (
    trigger: 'restore' | 'restore-behind' | 'replay',
    errorMessage: string
  ): Promise<boolean> => {
    if (
      attemptedInitialCommitRecovery ||
      !isRecoverableInitialCommitStateError(errorMessage)
    ) {
      return false
    }

    attemptedInitialCommitRecovery = true
    strategy = 'salvage-reclone'

    const recoveryContext = {
      projectId: String(project._id),
      projectSlug: project.slug,
      trigger,
      errorMessage,
      localPath: effectiveLocalPath,
    }

    console.warn(
      '[GitOpen] Missing initial commit state detected; attempting automatic salvage/reclone recovery',
      recoveryContext
    )
    logGitOpenDebug('prepare:missing_initial_commit_recovery', recoveryContext)

    if (!repoUrl) {
      throw new Error('Automatic recovery requires a configured remote repository URL.')
    }

    onProgress?.('Recovering local project...')
    const salvageResult = await window.electronAPI.sync.gitSalvageReclone({
      projectPath: effectiveLocalPath,
      repoUrl,
      branch,
      provider,
      accessToken,
      debug,
    })

    logGitOpenDebug('prepare:missing_initial_commit_recovery_result', {
      ...recoveryContext,
      salvageResult,
    })

    if (!salvageResult.success || !salvageResult.localPath) {
      console.warn(
        '[GitOpen] Automatic recovery after missing initial commit state failed',
        {
          ...recoveryContext,
          backupPath: salvageResult.backupPath ?? null,
          salvageError: salvageResult.error ?? null,
        }
      )
      return false
    }

    effectiveLocalPath = salvageResult.localPath
    remoteHeadCommit = salvageResult.headCommit ?? remoteHeadCommit
    changed = true

    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath: effectiveLocalPath,
      kind: 'restored',
    })

    status = await window.electronAPI.sync.gitStatus({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:status_after_missing_initial_commit_recovery', {
      ...recoveryContext,
      localPath: effectiveLocalPath,
      backupPath: salvageResult.backupPath ?? null,
      status,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after automatic recovery')
    }

    const recoveredRepoHealth = await window.electronAPI.sync.gitClassifyRepoHealth({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:repo_health_after_missing_initial_commit_recovery', {
      ...recoveryContext,
      localPath: effectiveLocalPath,
      repoHealth: recoveredRepoHealth,
    })
    if (recoveredRepoHealth.success && recoveredRepoHealth.health) {
      lastRepoHealth = recoveredRepoHealth.health
    }

    console.warn(
      '[GitOpen] Automatic recovery after missing initial commit state succeeded',
      {
        ...recoveryContext,
        localPath: effectiveLocalPath,
        backupPath: salvageResult.backupPath ?? null,
      }
    )
    return true
  }

    const repoHealth = await window.electronAPI.sync.gitClassifyRepoHealth({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
  logGitOpenDebug('prepare:repo_health', {
    projectId: String(project._id),
    effectiveLocalPath,
    repoHealth,
  })
  if (!repoHealth.success || !repoHealth.health) {
    throw new Error(repoHealth.error || 'Failed to inspect local git repository health')
  }
  lastRepoHealth = repoHealth.health

  if (repoHealth.health === 'merge_in_progress' || repoHealth.health === 'cherry_pick_in_progress') {
    strategy = 'conflict-resume'
    const conflictAction = await promptForGitConflicts({
      projectName: project.slug,
      projectPath: effectiveLocalPath,
      conflictedPaths: status.conflictedPaths,
    })
    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: status.currentBranch ?? undefined,
      cancelled: true,
      needsConflictResolution: conflictAction === 'resolve-now',
      conflictedPaths: status.conflictedPaths,
    }
    recordOutcome(conflictAction === 'later' ? 'cancelled' : 'manual_conflict', {
      conflictedPathsCount: result.conflictedPaths?.length ?? 0,
    })
    return finalizeProjectOpenResult(result)
  }

  if (
    repoHealth.health === 'rebase_in_progress' ||
    repoHealth.health === 'detached_head' ||
    repoHealth.health === 'index_locked' ||
    repoHealth.health === 'unrelated_history' ||
    repoHealth.health === 'broken'
  ) {
    strategy = 'salvage-reclone'
    if (!repoUrl) {
      throw new Error('Automatic recovery requires a configured remote repository URL.')
    }
    onProgress?.('Recovering local project...')
    const salvageResult = await window.electronAPI.sync.gitSalvageReclone({
      projectPath: effectiveLocalPath,
      repoUrl,
      branch,
      provider,
      accessToken,
      debug,
    })
    logGitOpenDebug('prepare:salvage_reclone', {
      projectId: String(project._id),
      effectiveLocalPath,
      salvageResult,
      health: repoHealth.health,
    })
    if (!salvageResult.success || !salvageResult.localPath) {
      throw new Error(salvageResult.error || 'Failed to recover local project')
    }
    effectiveLocalPath = salvageResult.localPath
    remoteHeadCommit = salvageResult.headCommit ?? remoteHeadCommit
    changed = true
    status = await window.electronAPI.sync.gitStatus({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:status_after_salvage', {
      projectId: String(project._id),
      effectiveLocalPath,
      status,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after local project recovery')
    }
  }

  const effectivelyEmptyWorkspace = await isEffectivelyEmptyLocalWorkspace(effectiveLocalPath)

  if (
    !remoteHeadCommit &&
    shouldAdoptWorkspaceForMissingRemote(project) &&
    !effectivelyEmptyWorkspace
  ) {
    onProgress?.('Preparing imported project history...')
    const adoptResult = await window.electronAPI.sync.gitAdoptWorkspace({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      debug,
    })
    logGitOpenDebug('prepare:adopt_workspace', {
      projectId: String(project._id),
      effectiveLocalPath,
      adoptResult,
    })
    if (!adoptResult.success) {
      throw new Error(adoptResult.error || 'Failed to prepare imported project for remote git')
    }
    changed = changed || Boolean(adoptResult.commitCreated)
    status = await window.electronAPI.sync.gitStatus({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:status_after_adopt_workspace', {
      projectId: String(project._id),
      effectiveLocalPath,
      status,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after preparing imported project')
    }
  }

  if (!remoteHeadCommit && status.headCommit) {
    strategy = 'bootstrap-publish'
    onProgress?.('Publishing missing remote history...')
    const bootstrapPushResult = await window.electronAPI.sync.gitPushMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      provider,
      accessToken,
    })
    logGitOpenDebug('prepare:bootstrap_remote_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      bootstrapPushResult,
      localHeadCommit: status.headCommit,
    })
    if (!bootstrapPushResult.success) {
      throw new Error(bootstrapPushResult.error || 'Failed to restore missing remote history')
    }
    remoteHeadCommit = bootstrapPushResult.headCommit ?? status.headCommit
    changed = true
    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath: effectiveLocalPath,
      kind: 'published',
    })
    status = await window.electronAPI.sync.gitStatus({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:status_after_bootstrap_remote_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      status,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after restoring remote history')
    }
  }

  const suspectedLocalWipe = (status.behind ?? 0) > 0 && shouldTreatAsSuspectedLocalWipe(status)

  if (!remoteHeadCommit && !status.headCommit && !effectivelyEmptyWorkspace) {
    strategy = 'bootstrap-publish'
    onProgress?.('Publishing local project to remote...')
    const bootstrapCommitResult = await window.electronAPI.sync.gitCommitAll({
      projectPath: effectiveLocalPath,
      message: 'bootstrap remote history',
    })
    logGitOpenDebug('prepare:bootstrap_initial_commit', {
      projectId: String(project._id),
      effectiveLocalPath,
      bootstrapCommitResult,
    })
    if (!bootstrapCommitResult.success) {
      throw new Error(bootstrapCommitResult.error || 'Failed to create initial project commit')
    }

    const bootstrapPushResult = await window.electronAPI.sync.gitPushMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      provider,
      accessToken,
    })
    logGitOpenDebug('prepare:bootstrap_initial_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      bootstrapPushResult,
      commitSha: bootstrapCommitResult.commitSha ?? null,
    })
    if (!bootstrapPushResult.success) {
      throw new Error(bootstrapPushResult.error || 'Failed to publish project files to the remote')
    }

    remoteHeadCommit = bootstrapPushResult.headCommit ?? bootstrapCommitResult.commitSha ?? null
    changed = true
    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath: effectiveLocalPath,
      kind: 'published',
    })
    status = await window.electronAPI.sync.gitStatus({
      projectPath: effectiveLocalPath,
      branch,
      debug,
    })
    logGitOpenDebug('prepare:status_after_bootstrap_initial_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      status,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after publishing project files')
    }
  }

  const shouldRestoreWorkspace =
    Boolean(remoteHeadCommit) &&
    (effectivelyEmptyWorkspace || suspectedLocalWipe)

  logGitOpenDebug('prepare:restore_decision', {
    projectId: String(project._id),
    effectiveLocalPath,
    fetchHeadCommit: remoteHeadCommit,
    behind: status.behind ?? 0,
    deletedCount: status.deletedCount ?? 0,
    changedPathCount: status.changedPaths?.length ?? 0,
    hasUntrackedChanges: status.hasUntrackedChanges ?? false,
    effectivelyEmptyWorkspace,
    suspectedLocalWipe,
    shouldRestoreWorkspace,
  })

  if (effectivelyEmptyWorkspace && !remoteHeadCommit && !status.headCommit) {
    // This is a new project that hasn't received its initial commit yet.
    // We return gracefully here so the AI builder can populate the files first.
    // The final initial commit will be triggered later via syncLocalSnapshotToCloud.
    recordOutcome('opened')
    return finalizeProjectOpenResult({
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: status.currentBranch ?? undefined,
    })
  }

  if (shouldRestoreWorkspace) {
    strategy = 'restore'
    onProgress?.('Restoring project files...')
    const restoreResult = await window.electronAPI.sync.gitRestoreMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      provider,
      accessToken,
      debug,
    })
    logGitOpenDebug('prepare:restore_result', {
      projectId: String(project._id),
      effectiveLocalPath,
      restoreResult,
    })
    if (!restoreResult.success) {
      const restoreError = restoreResult.error || 'Failed to restore project files from the remote'
      const recovered = await attemptInitialCommitRecovery('restore', restoreError)
      if (!recovered) {
        throw new Error(restoreError)
      }
    } else {
      changed = true
      dispatchGitStatusEvent({
        projectId: String(project._id),
        projectPath: effectiveLocalPath,
        kind: 'restored',
      })
      status = await window.electronAPI.sync.gitStatus({
        projectPath: effectiveLocalPath,
        branch,
        debug,
      })
      logGitOpenDebug('prepare:status_after_restore', {
        projectId: String(project._id),
        effectiveLocalPath,
        status,
      })
      if (!status.success || !status.isRepo) {
        throw new Error(status.error || 'Failed to verify git status after restore')
      }
    }
  }

  if (status.hasConflicts) {
    strategy = 'conflict-resume'
    const conflictAction = await promptForGitConflicts({
      projectName: project.slug,
      projectPath: effectiveLocalPath,
      conflictedPaths: status.conflictedPaths,
    })
    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: status.currentBranch ?? undefined,
      cancelled: true,
      needsConflictResolution: conflictAction === 'resolve-now',
      conflictedPaths: status.conflictedPaths,
    }
    recordOutcome(conflictAction === 'later' ? 'cancelled' : 'manual_conflict', {
      conflictedPathsCount: result.conflictedPaths?.length ?? 0,
    })
    return finalizeProjectOpenResult(result)
  }

  if (status.behind && status.behind > 0) {
    hadMeaningfulLocalState =
      Boolean(status.ahead && status.ahead > 0) ||
      Boolean(status.hasStagedChanges) ||
      Boolean(status.hasUnstagedChanges) ||
      Boolean(status.hasUntrackedChanges)

    logGitOpenDebug('prepare:sync_strategy', {
      projectId: String(project._id),
      effectiveLocalPath,
      behind: status.behind ?? 0,
      ahead: status.ahead ?? 0,
      hasMeaningfulLocalState: hadMeaningfulLocalState,
    })

    if (hadMeaningfulLocalState) {
      strategy = 'replay'
      onProgress?.('Replaying local changes...')
      const replayResult = await window.electronAPI.sync.gitReplayLocalCommits({
        projectPath: effectiveLocalPath,
        branch,
        repoUrl,
        provider,
        accessToken,
        debug,
      })
      logGitOpenDebug('prepare:replay_result', {
        projectId: String(project._id),
        effectiveLocalPath,
        replayResult,
      })
      if (replayResult.hadConflicts) {
        const conflictAction = await promptForGitConflicts({
          projectName: project.slug,
          projectPath: effectiveLocalPath,
          conflictedPaths: replayResult.conflictedPaths,
        })
        const result: PrepareGitProjectForOpenResult = {
          localPath: effectiveLocalPath,
          skipInitialSyncCheck: true,
          changed,
          currentBranch: status.currentBranch ?? undefined,
          cancelled: true,
          needsConflictResolution: conflictAction === 'resolve-now',
          conflictedPaths: replayResult.conflictedPaths,
        }
        recordOutcome(conflictAction === 'later' ? 'cancelled' : 'manual_conflict', {
          conflictedPathsCount: result.conflictedPaths?.length ?? 0,
        })
        return finalizeProjectOpenResult(result)
      }
      if (!replayResult.success) {
        const replayError =
          replayResult.error || 'Failed to replay local changes on top of remote history'
        const recovered = await attemptInitialCommitRecovery('replay', replayError)
        if (!recovered) {
          throw new Error(replayError)
        }
      } else {
        changed = true
        dispatchGitStatusEvent({
          projectId: String(project._id),
          projectPath: effectiveLocalPath,
          kind: 'pulled',
        })
      }
    } else {
      strategy = 'restore'
      onProgress?.('Refreshing local project...')
      const restoreResult = await window.electronAPI.sync.gitRestoreMain({
        projectPath: effectiveLocalPath,
        branch,
        repoUrl,
        provider,
        accessToken,
        debug,
      })
      logGitOpenDebug('prepare:restore_behind_result', {
        projectId: String(project._id),
        effectiveLocalPath,
        restoreResult,
      })
      if (!restoreResult.success) {
        const restoreError =
          restoreResult.error || 'Failed to refresh local project from the remote'
        const recovered = await attemptInitialCommitRecovery(
          'restore-behind',
          restoreError
        )
        if (!recovered) {
          throw new Error(restoreError)
        }
      } else {
        changed = true
        dispatchGitStatusEvent({
          projectId: String(project._id),
          projectPath: effectiveLocalPath,
          kind: 'restored',
        })
      }
    }
  }

  status = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
    debug,
  })
  logGitOpenDebug('prepare:status_after_pull', {
    projectId: String(project._id),
    effectiveLocalPath,
    status,
  })
  if (!status.success || !status.isRepo) {
    throw new Error(status.error || 'Failed to verify git status after pull')
  }

  if (status.hasConflicts) {
    strategy = 'conflict-resume'
    const conflictAction = await promptForGitConflicts({
      projectName: project.slug,
      projectPath: effectiveLocalPath,
      conflictedPaths: status.conflictedPaths,
    })
    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: status.currentBranch ?? undefined,
      cancelled: true,
      needsConflictResolution: conflictAction === 'resolve-now',
      conflictedPaths: status.conflictedPaths,
    }
    recordOutcome(conflictAction === 'later' ? 'cancelled' : 'manual_conflict', {
      conflictedPathsCount: result.conflictedPaths?.length ?? 0,
    })
    return finalizeProjectOpenResult(result)
  }

  if (status.ahead && status.ahead > 0) {
    onProgress?.('Publishing latest changes...')
    const pushResult = await window.electronAPI.sync.gitPushMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      provider,
      accessToken,
    })
    if (!pushResult.success) {
      throw new Error(pushResult.error || 'Failed to publish local git changes')
    }
    changed = true
    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath: effectiveLocalPath,
      kind: 'published',
    })
  }

  const finalStatus = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
    debug,
  })
  logGitOpenDebug('prepare:final_status', {
    projectId: String(project._id),
    effectiveLocalPath,
    finalStatus,
  })
  if (!finalStatus.success || !finalStatus.isRepo) {
    throw new Error(finalStatus.error || 'Failed to verify final git status')
  }

  if (finalStatus.hasConflicts) {
    strategy = 'conflict-resume'
    const conflictAction = await promptForGitConflicts({
      projectName: project.slug,
      projectPath: effectiveLocalPath,
      conflictedPaths: finalStatus.conflictedPaths,
    })
    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: finalStatus.currentBranch ?? undefined,
      cancelled: true,
      needsConflictResolution: conflictAction === 'resolve-now',
      conflictedPaths: finalStatus.conflictedPaths,
    }
    recordOutcome(conflictAction === 'later' ? 'cancelled' : 'manual_conflict', {
      conflictedPathsCount: result.conflictedPaths?.length ?? 0,
    })
    return finalizeProjectOpenResult(result)
  }

    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: finalStatus.currentBranch ?? undefined,
    }
    recordOutcome('opened')
    return finalizeProjectOpenResult(result)
  } catch (error) {
    recordOutcome('failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
