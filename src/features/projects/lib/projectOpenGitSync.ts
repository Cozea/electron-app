import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'
import { isGitOpenDebugEnabled, logGitOpenDebug } from '@/lib/git/gitOpenDebug'
import { recordGitOpenTelemetry, type GitOpenTelemetryEvent } from '@/lib/git/gitOpenTelemetry'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'

export interface GitRepositoryMetadataLike {
  provider?: string
  url?: string
  defaultBranch?: string | null
}

export interface ProjectOpenGitProjectLike {
  _id: Id<'projects'>
  slug: string
  organizationId: Id<'organizations'>
  syncMode?: 'replica' | 'git'
  localPath?: string | null
  gitRepository?: GitRepositoryMetadataLike | null
  sourceControl?: {
    provider?: string
    repoUrl?: string | null
  } | null
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
  if (project.sourceControl?.provider === 'local') {
    return true
  }

  const provider = project.gitRepository?.provider?.trim().toLowerCase()
  return Boolean(provider && provider !== 'cozea')
}

interface GitAuthPayload {
  accessToken?: string
}

function resolveGitBranch(project: ProjectOpenGitProjectLike): string {
  return project.gitRepository?.defaultBranch?.trim() || 'main'
}

async function resolveGitAuthPayload(): Promise<GitAuthPayload> {
  try {
    const session = await window.electronAPI.auth.getSession()
    return { accessToken: session?.accessToken }
  } catch (error) {
    console.warn('[GitOpen] Failed to resolve Cozea Git session:', error)
    return {}
  }
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

export async function prepareGitProjectForOpen({
  convex,
  project,
  localPath,
  userId,
  onProgress,
  updateMemberLocalPath,
}: PrepareGitProjectForOpenOptions): Promise<PrepareGitProjectForOpenResult> {
  void convex
  const repoUrl = buildCozeaGitRemoteUrl(String(project._id))
  const branch = resolveGitBranch(project)
  const auth = await resolveGitAuthPayload()
  const extraHeader = buildCozeaGitAuthHeader(auth.accessToken)
  const debug = isGitOpenDebugEnabled()
  let effectiveLocalPath = localPath ?? project.localPath ?? (await resolveTargetProjectPath(project))
  let changed = false
  const startedAt = Date.now()
  let strategy: GitOpenTelemetryEvent['strategy'] = 'clean'
  let lastRepoHealth: string | undefined
  let hadMeaningfulLocalState = false

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

  logGitOpenDebug('prepare:start', {
    projectId: String(project._id),
    projectSlug: project.slug,
    branch,
    repoUrl,
    providedLocalPath: localPath ?? null,
    projectLocalPath: project.localPath ?? null,
    effectiveLocalPath,
    hasAuthToken: Boolean(auth.accessToken),
  })

  try {
    if (!localPath) {
      onProgress?.('Cloning repository...')
      const cloneResult = await window.electronAPI.sync.gitCloneIfMissing({
        projectPath: effectiveLocalPath,
        repoUrl,
        branch,
        extraHeader,
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

    onProgress?.('Fetching latest changes...')
    const fetchResult = await window.electronAPI.sync.gitFetchMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      extraHeader,
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
    return result
  }

  if (
    repoHealth.health === 'rebase_in_progress' ||
    repoHealth.health === 'detached_head' ||
    repoHealth.health === 'index_locked' ||
    repoHealth.health === 'unrelated_history' ||
    repoHealth.health === 'broken'
  ) {
    strategy = 'salvage-reclone'
    onProgress?.('Recovering local project...')
    const salvageResult = await window.electronAPI.sync.gitSalvageReclone({
      projectPath: effectiveLocalPath,
      repoUrl,
      branch,
      extraHeader,
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

  let effectivelyEmptyWorkspace = await isEffectivelyEmptyLocalWorkspace(effectiveLocalPath)

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
      throw new Error(adoptResult.error || 'Failed to prepare imported project for Cozea Git')
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
    onProgress?.('Publishing missing cloud history...')
    const bootstrapPushResult = await window.electronAPI.sync.gitPushMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      extraHeader,
    })
    logGitOpenDebug('prepare:bootstrap_remote_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      bootstrapPushResult,
      localHeadCommit: status.headCommit,
    })
    if (!bootstrapPushResult.success) {
      throw new Error(bootstrapPushResult.error || 'Failed to restore missing cloud history')
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
      throw new Error(status.error || 'Failed to verify git status after restoring cloud history')
    }
  }

  const suspectedLocalWipe = (status.behind ?? 0) > 0 && shouldTreatAsSuspectedLocalWipe(status)

  if (!remoteHeadCommit && !status.headCommit && !effectivelyEmptyWorkspace) {
    strategy = 'bootstrap-publish'
    onProgress?.('Publishing local project to cloud...')
    const bootstrapCommitResult = await window.electronAPI.sync.gitCommitAll({
      projectPath: effectiveLocalPath,
      message: 'cozea: bootstrap cloud history',
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
      extraHeader,
    })
    logGitOpenDebug('prepare:bootstrap_initial_push', {
      projectId: String(project._id),
      effectiveLocalPath,
      bootstrapPushResult,
      commitSha: bootstrapCommitResult.commitSha ?? null,
    })
    if (!bootstrapPushResult.success) {
      throw new Error(bootstrapPushResult.error || 'Failed to publish project files to cloud')
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
    throw new Error('Cloud project history is unavailable and this local workspace is empty.')
  }

  if (shouldRestoreWorkspace) {
    strategy = 'restore'
    onProgress?.('Restoring project files...')
    const restoreResult = await window.electronAPI.sync.gitRestoreMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      extraHeader,
      debug,
    })
    logGitOpenDebug('prepare:restore_result', {
      projectId: String(project._id),
      effectiveLocalPath,
      restoreResult,
    })
    if (!restoreResult.success) {
      throw new Error(restoreResult.error || 'Failed to restore project files from cloud')
    }
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
    return result
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
        extraHeader,
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
        return result
      }
      if (!replayResult.success) {
        throw new Error(replayResult.error || 'Failed to replay local changes on top of cloud history')
      }
      changed = true
      dispatchGitStatusEvent({
        projectId: String(project._id),
        projectPath: effectiveLocalPath,
        kind: 'pulled',
      })
    } else {
      strategy = 'restore'
      onProgress?.('Refreshing local project...')
      const restoreResult = await window.electronAPI.sync.gitRestoreMain({
        projectPath: effectiveLocalPath,
        branch,
        repoUrl,
        extraHeader,
        debug,
      })
      logGitOpenDebug('prepare:restore_behind_result', {
        projectId: String(project._id),
        effectiveLocalPath,
        restoreResult,
      })
      if (!restoreResult.success) {
        throw new Error(restoreResult.error || 'Failed to refresh local project from cloud')
      }
      changed = true
      dispatchGitStatusEvent({
        projectId: String(project._id),
        projectPath: effectiveLocalPath,
        kind: 'restored',
      })
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
    return result
  }

  if (status.ahead && status.ahead > 0) {
    onProgress?.('Publishing latest changes...')
    const pushResult = await window.electronAPI.sync.gitPushMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      extraHeader,
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
    return result
  }

    if (userId && updateMemberLocalPath) {
      await updateMemberLocalPath({
        projectId: project._id,
        userId,
        localPath: effectiveLocalPath,
      })
    }

    const result: PrepareGitProjectForOpenResult = {
      localPath: effectiveLocalPath,
      skipInitialSyncCheck: true,
      changed,
      currentBranch: finalStatus.currentBranch ?? undefined,
    }
    recordOutcome('opened')
    return result
  } catch (error) {
    recordOutcome('failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
