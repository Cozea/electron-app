import path from 'node:path'

import type {
  GitSyncAdoptResult,
  GitSyncCommitPushResult,
  GitSyncCommitResult,
  GitSyncFetchResult,
  GitSyncPullResult,
  GitSyncPushResult,
  GitSyncRestoreResult,
} from '../../shared/electronApiTypes'
import type { GitCommandResult } from '../gitRuntime'
import {
  isMissingRemoteBranchError,
  isShallowUpdateRejected,
  normalizeGitBranch,
  normalizeGitRemote,
  normalizeGitRemoteUrl,
  type RepoMetadata,
} from './gitSyncShared'

interface GitRemoteSyncAuthOptions {
  repoUrl?: string
  extraHeader?: string
  provider?: string
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
  debug?: boolean
}

export interface GitFetchMainOptions extends GitRemoteSyncAuthOptions {
  projectPath: string
  remote?: string
  branch?: string
}

export interface GitPullMainOptions extends GitRemoteSyncAuthOptions {
  projectPath: string
  remote?: string
  branch?: string
  strategy?: 'merge' | 'ff-only'
  allowUnrelatedHistories?: boolean
}

export interface GitPushMainOptions extends GitRemoteSyncAuthOptions {
  projectPath: string
  remote?: string
  branch?: string
}

export interface GitCommitAndPushOptions extends GitPushMainOptions {
  message: string
  addAll?: boolean
}

interface GitRemoteSyncHelpers {
  debug: (enabled: boolean | undefined, event: string, payload: Record<string, unknown>) => void
  getRepoMetadata: (projectPath: string) => Promise<RepoMetadata>
  setRemoteUrl: (projectPath: string, repoUrl: string) => Promise<{ success: boolean; error?: string }>
  resolveExtraHeader: (options: GitRemoteSyncAuthOptions) => string | undefined
  runGit: (
    args: string[],
    options: { cwd: string; timeoutMs: number; extraHeader?: string }
  ) => Promise<GitCommandResult>
  getRevision: (projectPath: string, ref: string) => Promise<string | null>
  getCurrentBranch: (projectPath: string) => Promise<string | null>
  getStatus: (options: {
    projectPath: string
    remote?: string
    branch?: string
    debug?: boolean
  }) => Promise<{
    success: boolean
    isRepo: boolean
    hasConflicts?: boolean
    conflictedPaths?: string[]
    error?: string
  }>
  restoreMain: (options: GitPullMainOptions) => Promise<GitSyncRestoreResult>
  adoptWorkspace: (options: {
    projectPath: string
    branch?: string
    repoUrl?: string
    debug?: boolean
  }) => Promise<GitSyncAdoptResult>
  commitAll: (options: {
    projectPath: string
    message: string
    addAll?: boolean
  }) => Promise<GitSyncCommitResult>
}

async function maybeSetRemoteUrl(
  projectPath: string,
  repoUrl: string | undefined,
  helpers: Pick<GitRemoteSyncHelpers, 'setRemoteUrl'>
): Promise<{ success: boolean; error?: string }> {
  if (!repoUrl?.trim()) {
    return { success: true }
  }
  return helpers.setRemoteUrl(projectPath, normalizeGitRemoteUrl(repoUrl))
}

export async function fetchMain(
  options: GitFetchMainOptions,
  helpers: GitRemoteSyncHelpers
): Promise<GitSyncFetchResult> {
  const remote = normalizeGitRemote(options.remote)
  const branch = normalizeGitBranch(options.branch)
  const projectPath = path.resolve(options.projectPath)

  const metadata = await helpers.getRepoMetadata(projectPath)
  helpers.debug(options.debug, 'fetch:start', {
    projectPath,
    remote,
    branch,
    isRepo: metadata.isRepo,
    headCommit: metadata.headCommit ?? null,
    repoUrl: options.repoUrl ?? null,
  })
  if (!metadata.isRepo) {
    return { success: false, error: 'Project path is not a git repository' }
  }

  const remoteResult = await maybeSetRemoteUrl(projectPath, options.repoUrl, helpers)
  if (!remoteResult.success) {
    return { success: false, error: remoteResult.error }
  }

  const fetchResult = await helpers.runGit(['fetch', '--prune', remote, branch], {
    cwd: projectPath,
    extraHeader: helpers.resolveExtraHeader(options),
    timeoutMs: 120_000,
  })
  if (!fetchResult.success) {
    if (isMissingRemoteBranchError(fetchResult.error ?? '')) {
      helpers.debug(options.debug, 'fetch:missing_remote_branch', {
        projectPath,
        remote,
        branch,
        currentBranch: await helpers.getCurrentBranch(projectPath),
        headCommit: metadata.headCommit ?? null,
      })
      return {
        success: true,
        remote,
        branch,
        currentBranch: await helpers.getCurrentBranch(projectPath),
        upstreamRef: `${remote}/${branch}`,
        headCommit: undefined,
      }
    }
    return { success: false, error: fetchResult.error }
  }

  const remoteHead =
    (await helpers.getRevision(projectPath, `${remote}/${branch}`)) ??
    (await helpers.getRevision(projectPath, 'FETCH_HEAD'))
  const currentBranch = await helpers.getCurrentBranch(projectPath)
  helpers.debug(options.debug, 'fetch:success', {
    projectPath,
    remote,
    branch,
    currentBranch: currentBranch ?? null,
    remoteHead: remoteHead ?? metadata.headCommit ?? null,
  })
  return {
    success: true,
    remote,
    branch,
    currentBranch,
    upstreamRef: `${remote}/${branch}`,
    headCommit: remoteHead ?? metadata.headCommit,
  }
}

export async function pullMain(
  options: GitPullMainOptions,
  helpers: GitRemoteSyncHelpers
): Promise<GitSyncPullResult> {
  const remote = normalizeGitRemote(options.remote)
  const branch = normalizeGitBranch(options.branch)
  const strategy = options.strategy ?? 'merge'
  const projectPath = path.resolve(options.projectPath)

  const metadata = await helpers.getRepoMetadata(projectPath)
  helpers.debug(options.debug, 'pull:start', {
    projectPath,
    remote,
    branch,
    strategy,
    currentBranch: metadata.currentBranch ?? null,
    headCommit: metadata.headCommit ?? null,
  })
  if (!metadata.isRepo) {
    return {
      success: false,
      strategy,
      error: 'Project path is not a git repository',
    }
  }

  const remoteResult = await maybeSetRemoteUrl(projectPath, options.repoUrl, helpers)
  if (!remoteResult.success) {
    return {
      success: false,
      strategy,
      error: remoteResult.error,
    }
  }

  const beforeHead = metadata.headCommit
  const remoteHead =
    (await helpers.getRevision(projectPath, `${remote}/${branch}`)) ??
    (await helpers.getRevision(projectPath, 'FETCH_HEAD'))
  if (!beforeHead && remoteHead) {
    helpers.debug(options.debug, 'pull:delegating_restore', {
      projectPath,
      remote,
      branch,
      remoteHead,
    })
    const restore = await helpers.restoreMain(options)
    if (!restore.success) {
      return {
        success: false,
        remote,
        branch,
        strategy,
        error: restore.error,
        hadConflicts: false,
      }
    }
    return {
      success: true,
      remote,
      branch,
      strategy,
      currentBranch: restore.currentBranch,
      headCommit: restore.headCommit,
      alreadyUpToDate: false,
      hadConflicts: false,
      fastForward: true,
    }
  }

  const pullArgs =
    strategy === 'ff-only'
      ? ['pull', '--ff-only', remote, branch]
      : [
          'pull',
          '--no-rebase',
          '--no-edit',
          ...(options.allowUnrelatedHistories ? ['--allow-unrelated-histories'] : []),
          remote,
          branch,
        ]
  const pull = await helpers.runGit(pullArgs, {
    cwd: projectPath,
    extraHeader: helpers.resolveExtraHeader(options),
    timeoutMs: 120_000,
  })
  if (!pull.success) {
    const statusAfterFailure = await helpers.getStatus({
      projectPath,
      remote,
      branch,
      debug: options.debug,
    })
    const conflictedPaths =
      statusAfterFailure.success && statusAfterFailure.isRepo
        ? statusAfterFailure.conflictedPaths ?? []
        : []
    const hadConflicts =
      (statusAfterFailure.success && statusAfterFailure.isRepo && Boolean(statusAfterFailure.hasConflicts)) ||
      /conflict/i.test(pull.error ?? '')

    return {
      success: false,
      remote,
      branch,
      strategy,
      hadConflicts,
      conflictedPaths,
      error: pull.error,
    }
  }

  const afterHead = await helpers.getRevision(projectPath, 'HEAD')
  const combinedOutput = `${pull.stdout}\n${pull.stderr}`
  helpers.debug(options.debug, 'pull:result', {
    projectPath,
    remote,
    branch,
    beforeHead: beforeHead ?? null,
    afterHead: afterHead ?? null,
    alreadyUpToDate: /already up[ -]to[ -]date/i.test(combinedOutput),
    fastForward:
      /fast-forward/i.test(combinedOutput) ||
      (Boolean(beforeHead) && Boolean(afterHead) && beforeHead !== afterHead && strategy === 'ff-only'),
  })
  return {
    success: true,
    remote,
    branch,
    strategy,
    currentBranch: await helpers.getCurrentBranch(projectPath),
    headCommit: afterHead ?? beforeHead,
    alreadyUpToDate: /already up[ -]to[ -]date/i.test(combinedOutput),
    hadConflicts: false,
    fastForward:
      /fast-forward/i.test(combinedOutput) ||
      (Boolean(beforeHead) && Boolean(afterHead) && beforeHead !== afterHead && strategy === 'ff-only'),
  }
}

export async function pushMain(
  options: GitPushMainOptions,
  helpers: GitRemoteSyncHelpers
): Promise<GitSyncPushResult> {
  const remote = normalizeGitRemote(options.remote)
  const branch = normalizeGitBranch(options.branch)
  const projectPath = path.resolve(options.projectPath)

  const metadata = await helpers.getRepoMetadata(projectPath)
  if (!metadata.isRepo) {
    return {
      success: false,
      error: 'Project path is not a git repository',
    }
  }

  const remoteResult = await maybeSetRemoteUrl(projectPath, options.repoUrl, helpers)
  if (!remoteResult.success) {
    return {
      success: false,
      error: remoteResult.error,
    }
  }

  const push = await helpers.runGit(['push', remote, `HEAD:${branch}`], {
    cwd: projectPath,
    extraHeader: helpers.resolveExtraHeader(options),
    timeoutMs: 120_000,
  })
  if (!push.success) {
    if (isShallowUpdateRejected(push.error ?? '')) {
      helpers.debug(options.debug, 'push:shallow_rejected', {
        projectPath,
        remote,
        branch,
      })
      const adopt = await helpers.adoptWorkspace({
        projectPath,
        branch,
        repoUrl: options.repoUrl,
        debug: options.debug,
      })
      if (!adopt.success) {
        return {
          success: false,
          remote,
          branch,
          error: adopt.error || push.error,
        }
      }

      const retryPush = await helpers.runGit(['push', remote, `HEAD:${branch}`], {
        cwd: projectPath,
        extraHeader: helpers.resolveExtraHeader(options),
        timeoutMs: 120_000,
      })
      if (!retryPush.success) {
        return {
          success: false,
          remote,
          branch,
          error: retryPush.error,
        }
      }

      return {
        success: true,
        remote,
        branch,
        currentBranch: await helpers.getCurrentBranch(projectPath),
        headCommit: await helpers.getRevision(projectPath, 'HEAD') ?? undefined,
        pushed: true,
      }
    }

    return {
      success: false,
      remote,
      branch,
      error: push.error,
    }
  }

  return {
    success: true,
    remote,
    branch,
    currentBranch: await helpers.getCurrentBranch(projectPath),
    headCommit: await helpers.getRevision(projectPath, 'HEAD') ?? undefined,
    pushed: true,
  }
}

export async function commitAndPush(
  options: GitCommitAndPushOptions,
  helpers: GitRemoteSyncHelpers
): Promise<GitSyncCommitPushResult> {
  const remote = normalizeGitRemote(options.remote)
  const branch = normalizeGitBranch(options.branch)
  const projectPath = path.resolve(options.projectPath)

  const metadata = await helpers.getRepoMetadata(projectPath)
  if (!metadata.isRepo) {
    return {
      success: false,
      error: 'Project path is not a git repository',
    }
  }

  const commit = await helpers.commitAll({
    projectPath,
    message: options.message,
    addAll: options.addAll,
  })
  if (!commit.success) {
    return {
      success: false,
      remote,
      branch,
      error: commit.error,
    }
  }

  if (!commit.commitCreated) {
    return {
      success: true,
      remote,
      branch,
      currentBranch: metadata.currentBranch,
      commitCreated: false,
      pushed: false,
      commitSha: commit.commitSha,
    }
  }

  const push = await pushMain(options, helpers)
  if (!push.success) {
    return {
      success: false,
      remote,
      branch,
      commitCreated: true,
      pushed: false,
      commitSha: commit.commitSha,
      error: push.error,
    }
  }

  return {
    success: true,
    remote,
    branch,
    currentBranch: push.currentBranch ?? (await helpers.getCurrentBranch(projectPath)),
    commitCreated: true,
    pushed: true,
    commitSha: commit.commitSha,
  }
}
