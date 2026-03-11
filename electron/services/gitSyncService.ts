import fs from 'node:fs'
import path from 'node:path'

import type {
  GitSyncAdoptResult,
  GitSyncCloneResult,
  GitSyncCommitResult,
  GitSyncCommitPushResult,
  GitSyncEnsureRepoResult,
  GitSyncFetchResult,
  GitSyncPullResult,
  GitSyncPushResult,
  GitSyncRestoreResult,
  GitSyncStatusResult,
} from '../../shared/electronApiTypes'
import { buildGitAuthorizationHeader, resolveRepositoryAccessToken } from './gitAuth'
import { runGitCommand } from '../gitRuntime'

const DEFAULT_BRANCH = 'main'
const DEFAULT_REMOTE = 'origin'
const DEFAULT_GIT_USER_NAME = 'Cozea Sync'
const DEFAULT_GIT_USER_EMAIL = 'sync@cozea.local'

interface GitCommandOptions {
  cwd: string
  extraHeader?: string
  timeoutMs?: number
}

interface GitAuthOptions {
  provider?: string
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
  debug?: boolean
}

interface RepoMetadata {
  repoExists: boolean
  isRepo: boolean
  gitDir?: string
  topLevelPath?: string
  currentBranch?: string
  headCommit?: string
}

interface ParsedStatus {
  clean: boolean
  ahead: number
  behind: number
  upstreamBranch: string | null
  hasConflicts: boolean
  hasStagedChanges: boolean
  hasUnstagedChanges: boolean
  hasUntrackedChanges: boolean
  deletedCount: number
  changedPaths: string[]
}

export class GitSyncService {
  private static instance: GitSyncService

  static getInstance(): GitSyncService {
    if (!GitSyncService.instance) {
      GitSyncService.instance = new GitSyncService()
    }
    return GitSyncService.instance
  }

  private constructor() {}

  private debug(enabled: boolean | undefined, event: string, payload: Record<string, unknown>): void {
    if (!enabled) {
      return
    }

    console.info(`[GitOpenDebug][Main] ${event}`, payload)
  }

  async ensureRepo(options: {
    projectPath: string
    branch?: string
    repoUrl?: string
    debug?: boolean
  }): Promise<GitSyncEnsureRepoResult> {
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    try {
      fs.mkdirSync(projectPath, { recursive: true })

      const before = await this.getRepoMetadata(projectPath)
      let initialized = false

      if (!before.isRepo) {
        const init = await this.initializeRepository(projectPath, branch)
        if (!init.success) {
          return {
            success: false,
            isRepo: false,
            error: init.error,
          }
        }
        initialized = true
      }

      const configured = await this.ensureCommitIdentity(projectPath)
      if (!configured.success) {
        return {
          success: false,
          isRepo: true,
          error: configured.error,
        }
      }

      if (options.repoUrl?.trim()) {
        const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
        if (!remoteResult.success) {
          return {
            success: false,
            isRepo: true,
            error: remoteResult.error,
          }
        }
      }

      const after = await this.getRepoMetadata(projectPath)
      this.debug(options.debug, 'ensure_repo', {
        projectPath,
        branch,
        initialized,
        isRepo: after.isRepo,
        currentBranch: after.currentBranch ?? null,
        gitDir: after.gitDir ?? null,
        topLevelPath: after.topLevelPath ?? null,
      })
      return {
        success: true,
        isRepo: after.isRepo,
        initialized,
        currentBranch: after.currentBranch,
        gitDir: after.gitDir,
        topLevelPath: after.topLevelPath,
      }
    } catch (error) {
      return {
        success: false,
        isRepo: false,
        error: error instanceof Error ? error.message : 'Failed to ensure git repository',
      }
    }
  }

  async cloneIfMissing(options: {
    projectPath: string
    repoUrl: string
    branch?: string
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncCloneResult> {
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)
    const parentDir = path.dirname(projectPath)

    try {
      if (fs.existsSync(projectPath)) {
        const entries = fs.readdirSync(projectPath)
        if (entries.length > 0) {
          const metadata = await this.getRepoMetadata(projectPath)
          if (metadata.isRepo) {
            this.debug(options.debug, 'clone_if_missing:existing_repo', {
              projectPath,
              branch,
              currentBranch: metadata.currentBranch ?? null,
              headCommit: metadata.headCommit ?? null,
            })
            return {
              success: true,
              cloned: false,
              localPath: projectPath,
              currentBranch: metadata.currentBranch,
              headCommit: metadata.headCommit,
              remoteUrl: await this.getRemoteUrl(projectPath),
            }
          }
          return {
            success: false,
            error: `Destination already exists and is not a git repository: ${projectPath}`,
          }
        }
        fs.rmSync(projectPath, { recursive: true, force: true })
      }

      fs.mkdirSync(parentDir, { recursive: true })
      const cloneArgs = ['clone', '--branch', branch, '--single-branch', this.normalizeRemoteUrl(options.repoUrl), projectPath]
      let clone = await this.runGit(cloneArgs, {
        cwd: parentDir,
        extraHeader: this.resolveExtraHeader(options),
        timeoutMs: 120_000,
      })
      if (!clone.success && this.isMissingRemoteBranchError(clone.error)) {
        clone = await this.runGit(['clone', this.normalizeRemoteUrl(options.repoUrl), projectPath], {
          cwd: parentDir,
          extraHeader: this.resolveExtraHeader(options),
          timeoutMs: 120_000,
        })
      }
      if (!clone.success) {
        return { success: false, error: clone.error }
      }

      const configured = await this.ensureCommitIdentity(projectPath)
      if (!configured.success) {
        return { success: false, error: configured.error }
      }

      const metadata = await this.getRepoMetadata(projectPath)
      this.debug(options.debug, 'clone_if_missing:cloned', {
        projectPath,
        branch,
        currentBranch: metadata.currentBranch ?? null,
        headCommit: metadata.headCommit ?? null,
        remoteUrl: await this.getRemoteUrl(projectPath),
      })
      return {
        success: true,
        cloned: true,
        localPath: projectPath,
        currentBranch: metadata.currentBranch,
        headCommit: metadata.headCommit,
        remoteUrl: await this.getRemoteUrl(projectPath),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clone repository',
      }
    }
  }

  async fetchMain(options: {
    projectPath: string
    remote?: string
    branch?: string
    repoUrl?: string
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncFetchResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    this.debug(options.debug, 'fetch:start', {
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

    if (options.repoUrl?.trim()) {
      const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
      if (!remoteResult.success) {
        return { success: false, error: remoteResult.error }
      }
    }

    const fetchResult = await this.runGit(['fetch', '--prune', remote, branch], {
      cwd: projectPath,
      extraHeader: this.resolveExtraHeader(options),
      timeoutMs: 120_000,
    })
    if (!fetchResult.success) {
      if (this.isMissingRemoteBranchError(fetchResult.error)) {
        this.debug(options.debug, 'fetch:missing_remote_branch', {
          projectPath,
          remote,
          branch,
          currentBranch: await this.getCurrentBranch(projectPath),
          headCommit: metadata.headCommit ?? null,
        })
        return {
          success: true,
          remote,
          branch,
          currentBranch: await this.getCurrentBranch(projectPath),
          upstreamRef: `${remote}/${branch}`,
          headCommit: undefined,
        }
      }
      return { success: false, error: fetchResult.error }
    }

    const remoteHead =
      (await this.getRevision(projectPath, `${remote}/${branch}`)) ??
      (await this.getRevision(projectPath, 'FETCH_HEAD'))
    const currentBranch = await this.getCurrentBranch(projectPath)
    this.debug(options.debug, 'fetch:success', {
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

  async getStatus(options: {
    projectPath: string
    remote?: string
    branch?: string
    debug?: boolean
  }): Promise<GitSyncStatusResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)
    const metadata = await this.getRepoMetadata(projectPath)
    this.debug(options.debug, 'status:start', {
      projectPath,
      remote,
      branch,
      repoExists: metadata.repoExists,
      isRepo: metadata.isRepo,
      currentBranch: metadata.currentBranch ?? null,
      headCommit: metadata.headCommit ?? null,
    })

    if (!metadata.repoExists) {
      return {
        success: true,
        repoExists: false,
        isRepo: false,
      }
    }

    if (!metadata.isRepo) {
      return {
        success: true,
        repoExists: true,
        isRepo: false,
      }
    }

    const status = await this.runGit(
      ['status', '--porcelain=v1', '--branch', '--untracked-files=all'],
      { cwd: projectPath, timeoutMs: 20_000 }
    )
    if (!status.success) {
      return {
        success: false,
        repoExists: true,
        isRepo: true,
        error: status.error,
      }
    }

    let ahead = 0
    let behind = 0
    const parsed = this.parseStatus(status.stdout)
    ahead = parsed.ahead
    behind = parsed.behind

    const explicitRemoteHead =
      (await this.getRevision(projectPath, `${remote}/${branch}`)) ??
      (await this.getRevision(projectPath, 'FETCH_HEAD'))
    if (!metadata.headCommit && explicitRemoteHead) {
      behind = (await this.getRevisionCount(projectPath, `${remote}/${branch}`)) ?? 1
    } else if (metadata.headCommit && !explicitRemoteHead) {
      ahead = (await this.getRevisionCount(projectPath, 'HEAD')) ?? 1
    } else if ((ahead === 0 && behind === 0) && explicitRemoteHead && metadata.headCommit) {
      const aheadBehind = await this.getAheadBehind(projectPath, metadata.headCommit, explicitRemoteHead)
      if (aheadBehind) {
        ahead = aheadBehind.ahead
        behind = aheadBehind.behind
      }
    }

    this.debug(options.debug, 'status:result', {
      projectPath,
      remote,
      branch,
      currentBranch: metadata.currentBranch ?? null,
      ahead,
      behind,
      clean: parsed.clean,
      hasConflicts: parsed.hasConflicts,
      hasStagedChanges: parsed.hasStagedChanges,
      hasUnstagedChanges: parsed.hasUnstagedChanges,
      hasUntrackedChanges: parsed.hasUntrackedChanges,
      deletedCount: parsed.deletedCount,
      changedPathCount: parsed.changedPaths.length,
      changedPathsSample: parsed.changedPaths.slice(0, 20),
      explicitRemoteHead: explicitRemoteHead ?? null,
    })

    return {
      success: true,
      repoExists: true,
      isRepo: true,
      gitDir: metadata.gitDir,
      topLevelPath: metadata.topLevelPath,
      currentBranch: metadata.currentBranch,
      headCommit: metadata.headCommit,
      upstreamBranch: parsed.upstreamBranch,
      clean: parsed.clean,
      ahead,
      behind,
      hasConflicts: parsed.hasConflicts,
      hasStagedChanges: parsed.hasStagedChanges,
      hasUnstagedChanges: parsed.hasUnstagedChanges,
      hasUntrackedChanges: parsed.hasUntrackedChanges,
      deletedCount: parsed.deletedCount,
      changedPaths: parsed.changedPaths,
    }
  }

  async pullMain(options: {
    projectPath: string
    remote?: string
    branch?: string
    repoUrl?: string
    strategy?: 'merge' | 'ff-only'
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncPullResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const strategy = options.strategy ?? 'merge'
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    this.debug(options.debug, 'pull:start', {
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

    if (options.repoUrl?.trim()) {
      const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
      if (!remoteResult.success) {
        return {
          success: false,
          strategy,
          error: remoteResult.error,
        }
      }
    }

    const beforeHead = metadata.headCommit
    const remoteHead =
      (await this.getRevision(projectPath, `${remote}/${branch}`)) ??
      (await this.getRevision(projectPath, 'FETCH_HEAD'))
    if (!beforeHead && remoteHead) {
      this.debug(options.debug, 'pull:delegating_restore', {
        projectPath,
        remote,
        branch,
        remoteHead,
      })
      const restore = await this.restoreMain(options)
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
        : ['pull', '--no-edit', remote, branch]
    const pull = await this.runGit(pullArgs, {
      cwd: projectPath,
      extraHeader: this.resolveExtraHeader(options),
      timeoutMs: 120_000,
    })
    if (!pull.success) {
      return {
        success: false,
        remote,
        branch,
        strategy,
        hadConflicts: /conflict/i.test(pull.error),
        error: pull.error,
      }
    }

    const afterHead = await this.getRevision(projectPath, 'HEAD')
    const combinedOutput = `${pull.stdout}\n${pull.stderr}`
    this.debug(options.debug, 'pull:result', {
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
      currentBranch: await this.getCurrentBranch(projectPath),
      headCommit: afterHead ?? beforeHead,
      alreadyUpToDate: /already up[ -]to[ -]date/i.test(combinedOutput),
      hadConflicts: false,
      fastForward:
        /fast-forward/i.test(combinedOutput) ||
        (Boolean(beforeHead) && Boolean(afterHead) && beforeHead !== afterHead && strategy === 'ff-only'),
    }
  }

  async restoreMain(options: {
    projectPath: string
    remote?: string
    branch?: string
    repoUrl?: string
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncRestoreResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    this.debug(options.debug, 'restore:start', {
      projectPath,
      remote,
      branch,
      isRepo: metadata.isRepo,
      currentBranch: metadata.currentBranch ?? null,
      headCommit: metadata.headCommit ?? null,
      repoUrl: options.repoUrl ?? null,
    })
    if (!metadata.isRepo) {
      return {
        success: false,
        error: 'Project path is not a git repository',
      }
    }

    if (options.repoUrl?.trim()) {
      const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
      if (!remoteResult.success) {
        return {
          success: false,
          remote,
          branch,
          error: remoteResult.error,
        }
      }
    }

    const remoteHead = await this.getRevision(projectPath, `${remote}/${branch}`)
    if (!remoteHead) {
      this.debug(options.debug, 'restore:missing_remote_head', {
        projectPath,
        remote,
        branch,
      })
      return {
        success: false,
        remote,
        branch,
        error: `Remote branch ${remote}/${branch} does not exist`,
      }
    }

    const checkout = await this.runGit(['checkout', '-B', branch, `${remote}/${branch}`], {
      cwd: projectPath,
      extraHeader: this.resolveExtraHeader(options),
      timeoutMs: 120_000,
    })
    if (!checkout.success) {
      return {
        success: false,
        remote,
        branch,
        error: checkout.error,
      }
    }

    const clean = await this.runGit(['clean', '-fd'], {
      cwd: projectPath,
      timeoutMs: 60_000,
    })
    if (!clean.success) {
      return {
        success: false,
        remote,
        branch,
        error: clean.error,
      }
    }

    const upstream = await this.runGit(['branch', '--set-upstream-to', `${remote}/${branch}`, branch], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!upstream.success) {
      console.warn('[GitSyncService] Failed to set upstream after restore:', upstream.error)
    }

    const currentBranch = await this.getCurrentBranch(projectPath)
    const headCommit = await this.getRevision(projectPath, 'HEAD') ?? remoteHead
    this.debug(options.debug, 'restore:success', {
      projectPath,
      remote,
      branch,
      currentBranch: currentBranch ?? null,
      headCommit,
      remoteHead,
    })

    return {
      success: true,
      remote,
      branch,
      currentBranch,
      headCommit,
      restored: true,
    }
  }

  async adoptWorkspace(options: {
    projectPath: string
    branch?: string
    repoUrl?: string
    debug?: boolean
  }): Promise<GitSyncAdoptResult> {
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    try {
      const gitDirPath = path.join(projectPath, '.git')
      if (fs.existsSync(gitDirPath)) {
        fs.rmSync(gitDirPath, { recursive: true, force: true })
      }

      fs.mkdirSync(projectPath, { recursive: true })

      const init = await this.initializeRepository(projectPath, branch)
      if (!init.success) {
        return {
          success: false,
          error: init.error,
        }
      }

      const configured = await this.ensureCommitIdentity(projectPath)
      if (!configured.success) {
        return {
          success: false,
          error: configured.error,
        }
      }

      if (options.repoUrl?.trim()) {
        const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
        if (!remoteResult.success) {
          return {
            success: false,
            error: remoteResult.error,
          }
        }
      }

      const commitResult = await this.commitAll({
        projectPath,
        message: 'cozea: bootstrap cloud history',
      })
      if (!commitResult.success) {
        return {
          success: false,
          error: commitResult.error,
        }
      }

      this.debug(options.debug, 'adopt_workspace:success', {
        projectPath,
        branch,
        commitCreated: commitResult.commitCreated ?? false,
        headCommit: commitResult.commitSha ?? null,
      })

      return {
        success: true,
        currentBranch: commitResult.currentBranch ?? branch,
        headCommit: commitResult.commitSha,
        commitCreated: commitResult.commitCreated,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to adopt workspace into Cozea Git',
      }
    }
  }

  async commitAll(options: {
    projectPath: string
    message: string
    addAll?: boolean
  }): Promise<GitSyncCommitResult> {
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return {
        success: false,
        error: 'Project path is not a git repository',
      }
    }

    const configured = await this.ensureCommitIdentity(projectPath)
    if (!configured.success) {
      return {
        success: false,
        error: configured.error,
      }
    }

    if (options.addAll !== false) {
      const add = await this.runGit(['add', '-A'], { cwd: projectPath, timeoutMs: 30_000 })
      if (!add.success) {
        return {
          success: false,
          error: add.error,
        }
      }
    }

    const status = await this.runGit(['status', '--porcelain=v1'], { cwd: projectPath, timeoutMs: 20_000 })
    if (!status.success) {
      return {
        success: false,
        error: status.error,
      }
    }

    if (!status.stdout.trim()) {
      return {
        success: true,
        currentBranch: metadata.currentBranch,
        commitCreated: false,
        commitSha: metadata.headCommit,
      }
    }

    const commit = await this.runGit(['commit', '-m', options.message.trim() || 'cozea: sync workspace'], {
      cwd: projectPath,
      timeoutMs: 60_000,
    })
    if (!commit.success) {
      return {
        success: false,
        error: commit.error,
      }
    }

    return {
      success: true,
      currentBranch: await this.getCurrentBranch(projectPath),
      commitCreated: true,
      commitSha: await this.getRevision(projectPath, 'HEAD') ?? undefined,
    }
  }

  async pushMain(options: {
    projectPath: string
    remote?: string
    branch?: string
    repoUrl?: string
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncPushResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return {
        success: false,
        error: 'Project path is not a git repository',
      }
    }

    if (options.repoUrl?.trim()) {
      const remoteResult = await this.setRemoteUrl(projectPath, this.normalizeRemoteUrl(options.repoUrl))
      if (!remoteResult.success) {
        return {
          success: false,
          error: remoteResult.error,
        }
      }
    }

    const push = await this.runGit(['push', remote, `HEAD:${branch}`], {
      cwd: projectPath,
      extraHeader: this.resolveExtraHeader(options),
      timeoutMs: 120_000,
    })
    if (!push.success) {
      if (this.isShallowUpdateRejected(push.error)) {
        this.debug(options.debug, 'push:shallow_rejected', {
          projectPath,
          remote,
          branch,
        })
        const adopt = await this.adoptWorkspace({
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

        const retryPush = await this.runGit(['push', remote, `HEAD:${branch}`], {
          cwd: projectPath,
          extraHeader: this.resolveExtraHeader(options),
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
          currentBranch: await this.getCurrentBranch(projectPath),
          headCommit: await this.getRevision(projectPath, 'HEAD') ?? undefined,
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
      currentBranch: await this.getCurrentBranch(projectPath),
      headCommit: await this.getRevision(projectPath, 'HEAD') ?? undefined,
      pushed: true,
    }
  }

  async commitAndPush(options: {
    projectPath: string
    message: string
    remote?: string
    branch?: string
    repoUrl?: string
    addAll?: boolean
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
  }): Promise<GitSyncCommitPushResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)

    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return {
        success: false,
        error: 'Project path is not a git repository',
      }
    }

    const commit = await this.commitAll({
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

    const push = await this.pushMain({
      projectPath,
      remote,
      branch,
      repoUrl: options.repoUrl,
      extraHeader: options.extraHeader,
      provider: options.provider,
      accessToken: options.accessToken,
      encryptedCredentials: options.encryptedCredentials,
      keyId: options.keyId,
    })
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
      currentBranch: push.currentBranch ?? (await this.getCurrentBranch(projectPath)),
      commitCreated: true,
      pushed: true,
      commitSha: commit.commitSha,
    }
  }

  private async initializeRepository(projectPath: string, branch: string) {
    const init = await this.runGit(['init', '-b', branch], { cwd: projectPath, timeoutMs: 20_000 })
    if (!init.success) {
      const fallback = await this.runGit(['init'], { cwd: projectPath, timeoutMs: 20_000 })
      if (!fallback.success) {
        return fallback
      }
      const branchSet = await this.runGit(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], {
        cwd: projectPath,
        timeoutMs: 20_000,
      })
      if (!branchSet.success) {
        return branchSet
      }
      return fallback
    }
    return init
  }

  private async ensureCommitIdentity(projectPath: string) {
    const name = await this.runGit(['config', 'user.name', DEFAULT_GIT_USER_NAME], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!name.success) return name

    return this.runGit(['config', 'user.email', DEFAULT_GIT_USER_EMAIL], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
  }

  private async setRemoteUrl(projectPath: string, repoUrl: string) {
    const existing = await this.runGit(['remote', 'get-url', DEFAULT_REMOTE], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (existing.success) {
      return this.runGit(['remote', 'set-url', DEFAULT_REMOTE, repoUrl], {
        cwd: projectPath,
        timeoutMs: 10_000,
      })
    }
    return this.runGit(['remote', 'add', DEFAULT_REMOTE, repoUrl], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
  }

  private async getRepoMetadata(projectPath: string): Promise<RepoMetadata> {
    if (!fs.existsSync(projectPath)) {
      return { repoExists: false, isRepo: false }
    }

    const inside = await this.runGit(['rev-parse', '--is-inside-work-tree'], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!inside.success || inside.stdout.trim() !== 'true') {
      return { repoExists: true, isRepo: false }
    }

    const [gitDir, topLevelPath, currentBranch, headCommit] = await Promise.all([
      this.getSingleValue(projectPath, ['rev-parse', '--git-dir']),
      this.getSingleValue(projectPath, ['rev-parse', '--show-toplevel']),
      this.getCurrentBranch(projectPath),
      this.getRevision(projectPath, 'HEAD'),
    ])

    return {
      repoExists: true,
      isRepo: true,
      gitDir: gitDir ?? undefined,
      topLevelPath: topLevelPath ?? undefined,
      currentBranch: currentBranch ?? undefined,
      headCommit: headCommit ?? undefined,
    }
  }

  private async getCurrentBranch(projectPath: string): Promise<string | null> {
    const result = await this.runGit(['branch', '--show-current'], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!result.success) return null
    const value = result.stdout.trim()
    return value || null
  }

  private async getRevision(projectPath: string, ref: string): Promise<string | null> {
    return this.getSingleValue(projectPath, ['rev-parse', ref])
  }

  private async getRemoteUrl(projectPath: string): Promise<string | undefined> {
    const value = await this.getSingleValue(projectPath, ['remote', 'get-url', DEFAULT_REMOTE])
    return value ?? undefined
  }

  private async getSingleValue(projectPath: string, args: string[]): Promise<string | null> {
    const result = await this.runGit(args, {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!result.success) return null
    const value = result.stdout.trim()
    return value || null
  }

  private async getAheadBehind(projectPath: string, localRef: string, remoteRef: string): Promise<{ ahead: number; behind: number } | null> {
    const result = await this.runGit(['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!result.success) {
      return null
    }

    const parts = result.stdout.trim().split(/\s+/)
    if (parts.length !== 2) return null
    const ahead = Number(parts[0])
    const behind = Number(parts[1])
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
      return null
    }
    return { ahead, behind }
  }

  private async getRevisionCount(projectPath: string, ref: string): Promise<number | null> {
    const result = await this.runGit(['rev-list', '--count', ref], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!result.success) {
      return null
    }
    const count = Number(result.stdout.trim())
    return Number.isFinite(count) ? count : null
  }

  private parseStatus(stdout: string): ParsedStatus {
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    let ahead = 0
    let behind = 0
    let upstreamBranch: string | null = null
    let hasConflicts = false
    let hasStagedChanges = false
    let hasUnstagedChanges = false
    let hasUntrackedChanges = false
    let deletedCount = 0
    const changedPaths: string[] = []

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const branchInfo = line.slice(3)
        const upstreamMatch = branchInfo.match(/\.{3}([^\s]+)(?:\s|$)/)
        if (upstreamMatch) {
          upstreamBranch = upstreamMatch[1]
        }
        const aheadMatch = branchInfo.match(/ahead (\d+)/)
        const behindMatch = branchInfo.match(/behind (\d+)/)
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0
        behind = behindMatch ? Number(behindMatch[1]) : 0
        continue
      }

      const code = line.slice(0, 2)
      const rawPath = line.slice(3).trim()
      const normalizedPath = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop()?.trim() ?? rawPath
        : rawPath
      if (normalizedPath) {
        changedPaths.push(normalizedPath)
      }

      const staged = code[0]
      const unstaged = code[1]
      if (staged === '?' && unstaged === '?') {
        hasUntrackedChanges = true
        continue
      }
      if (staged === 'D' || unstaged === 'D') {
        deletedCount += 1
      }
      if ('UADRC'.includes(staged) || 'UADRC'.includes(unstaged)) {
        hasConflicts = hasConflicts || staged === 'U' || unstaged === 'U' || code === 'AA' || code === 'DD'
      }
      if (staged !== ' ') hasStagedChanges = true
      if (unstaged !== ' ') hasUnstagedChanges = true
    }

    return {
      clean: !hasConflicts && !hasStagedChanges && !hasUnstagedChanges && !hasUntrackedChanges,
      ahead,
      behind,
      upstreamBranch,
      hasConflicts,
      hasStagedChanges,
      hasUnstagedChanges,
      hasUntrackedChanges,
      deletedCount,
      changedPaths,
    }
  }

  private normalizeBranch(branch?: string): string {
    return branch?.trim() || DEFAULT_BRANCH
  }

  private normalizeRemote(remote?: string): string {
    return remote?.trim() || DEFAULT_REMOTE
  }

  private normalizeRemoteUrl(repoUrl: string): string {
    return repoUrl.trim()
  }

  private isShallowUpdateRejected(error: string | undefined): boolean {
    if (!error) {
      return false
    }

    return /shallow update not allowed/i.test(error)
  }

  private resolveExtraHeader(options: GitAuthOptions & { extraHeader?: string }): string | undefined {
    const explicit = options.extraHeader?.trim()
    if (explicit) {
      return explicit
    }

    if (!options.provider) {
      return undefined
    }

    const resolved = resolveRepositoryAccessToken({
      provider: options.provider,
      accessToken: options.accessToken,
      encryptedCredentials: options.encryptedCredentials,
      keyId: options.keyId,
    })
    if (resolved.error || !resolved.accessToken) {
      return undefined
    }
    return buildGitAuthorizationHeader(options.provider, resolved.accessToken) ?? undefined
  }

  private isMissingRemoteBranchError(error: string | undefined): boolean {
    const message = error?.toLowerCase() ?? ''
    if (!message) return false
    return (
      message.includes("couldn't find remote ref") ||
      (message.includes('remote branch') && message.includes('not found')) ||
      message.includes('remote head refers to nonexistent ref') ||
      message.includes('no such ref was fetched')
    )
  }

  private async runGit(args: string[], options: GitCommandOptions) {
    const prefixedArgs = options.extraHeader?.trim()
      ? ['-c', `http.extraheader=${options.extraHeader.trim()}`, ...args]
      : args

    const result = await runGitCommand(prefixedArgs, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 60_000,
    })

    if (result.success) {
      return result
    }

    return {
      ...result,
      error:
        result.error ||
        result.stderr.trim() ||
        result.stdout.trim() ||
        `git exited with code ${result.exitCode ?? 'unknown'}`,
    }
  }
}
