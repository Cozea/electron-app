import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'
import { isGitOpenDebugEnabled, logGitOpenDebug } from '@/lib/git/gitOpenDebug'
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

    if (userId && updateMemberLocalPath) {
      await updateMemberLocalPath({
        projectId: project._id,
        userId,
        localPath: effectiveLocalPath,
      })
    }
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
    throw new Error('Local git conflicts must be resolved before the project can be opened.')
  }

  if (
    status.behind &&
    status.behind > 0 &&
    (status.hasStagedChanges || status.hasUnstagedChanges || status.hasUntrackedChanges)
  ) {
    onProgress?.('Saving local changes...')
    const commitResult = await window.electronAPI.sync.gitCommitAll({
      projectPath: effectiveLocalPath,
      message: 'cozea: sync workspace',
    })
    logGitOpenDebug('prepare:commit_before_pull', {
      projectId: String(project._id),
      effectiveLocalPath,
      commitResult,
    })
    if (!commitResult.success) {
      throw new Error(commitResult.error || 'Failed to save local git changes')
    }
    changed = changed || Boolean(commitResult.commitCreated)
  }

  if (status.behind && status.behind > 0) {
    onProgress?.('Pulling latest changes...')
    const pullResult = await window.electronAPI.sync.gitPullMain({
      projectPath: effectiveLocalPath,
      branch,
      repoUrl,
      strategy: 'merge',
      extraHeader,
      debug,
    })
    logGitOpenDebug('prepare:pull_result', {
      projectId: String(project._id),
      effectiveLocalPath,
      pullResult,
    })
    if (!pullResult.success) {
      throw new Error(pullResult.error || 'Failed to pull latest project changes')
    }
    if (pullResult.hadConflicts) {
      throw new Error('Git merge conflicts must be resolved before the project can be opened.')
    }
    changed = changed || !pullResult.alreadyUpToDate
    if (!pullResult.alreadyUpToDate) {
      dispatchGitStatusEvent({
        projectId: String(project._id),
        projectPath: effectiveLocalPath,
        kind: 'pulled',
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
    throw new Error('Local git conflicts must be resolved before the project can be opened.')
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
    throw new Error('Local git conflicts must be resolved before the project can be opened.')
  }

  return {
    localPath: effectiveLocalPath,
    skipInitialSyncCheck: true,
    changed,
    currentBranch: finalStatus.currentBranch ?? undefined,
  }
}
