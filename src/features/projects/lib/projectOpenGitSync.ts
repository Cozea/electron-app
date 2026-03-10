import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'

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

async function resolveTargetProjectPath(projectSlug: string): Promise<string> {
  const settings = await window.electronAPI.settings.get()
  return `${settings.projectsDirectory.replace(/\/+$/, '')}/${projectSlug}`
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
  let effectiveLocalPath = localPath ?? (await resolveTargetProjectPath(project.slug))
  let changed = false

  if (!localPath) {
    onProgress?.('Cloning repository...')
    const cloneResult = await window.electronAPI.sync.gitCloneIfMissing({
      projectPath: effectiveLocalPath,
      repoUrl,
      branch,
      extraHeader,
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
  })
  if (!fetchResult.success) {
    throw new Error(fetchResult.error || 'Failed to fetch latest project changes')
  }

  let status = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
  })
  if (!status.success || !status.isRepo) {
    throw new Error(status.error || 'Failed to read local git status')
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
    })
    if (!pullResult.success) {
      throw new Error(pullResult.error || 'Failed to pull latest project changes')
    }
    if (pullResult.hadConflicts) {
      throw new Error('Git merge conflicts must be resolved before the project can be opened.')
    }
    changed = changed || !pullResult.alreadyUpToDate
  }

  status = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
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
  }

  const finalStatus = await window.electronAPI.sync.gitStatus({
    projectPath: effectiveLocalPath,
    branch,
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
