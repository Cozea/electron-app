import fs from 'node:fs'
import path from 'node:path'

import type {
  GitConflictFileResult,
  GitRepoHealthResult,
  GitSyncAdoptResult,
  GitSyncCloneResult,
  GitSyncCommitResult,
  GitSyncCommitPushResult,
  GitSyncEnsureRepoResult,
  GitSyncFetchResult,
  GitSyncPullResult,
  GitSyncReplayResult,
  GitSyncSalvageResult,
  GitSyncPushResult,
  GitResolveConflictResult,
  GitSyncRestoreResult,
  GitSyncStatusResult,
} from '../../shared/electronApiTypes'
import { buildGitAuthorizationHeader, resolveRepositoryAccessToken } from './gitAuth'
import { classifyConflictPath, tryMergeJsonConflict } from './gitConflictHeuristics'
import { mergeTextWithGit, runGitCommand } from '../gitRuntime'

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
  conflictedPaths: string[]
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
      conflictedPathCount: parsed.conflictedPaths.length,
      conflictedPathsSample: parsed.conflictedPaths.slice(0, 20),
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
      conflictedPaths: parsed.conflictedPaths,
    }
  }

  async pullMain(options: {
    projectPath: string
    remote?: string
    branch?: string
    repoUrl?: string
    strategy?: 'merge' | 'ff-only'
    allowUnrelatedHistories?: boolean
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
        : [
            'pull',
            '--no-rebase',
            '--no-edit',
            ...(options.allowUnrelatedHistories ? ['--allow-unrelated-histories'] : []),
            remote,
            branch,
          ]
    const pull = await this.runGit(pullArgs, {
      cwd: projectPath,
      extraHeader: this.resolveExtraHeader(options),
      timeoutMs: 120_000,
    })
    if (!pull.success) {
      const statusAfterFailure = await this.getStatus({
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
        /conflict/i.test(pull.error)

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

  async replayLocalCommits(options: {
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
  }): Promise<GitSyncReplayResult> {
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const projectPath = path.resolve(options.projectPath)
    const remoteRef = `${remote}/${branch}`

    const metadata = await this.getRepoMetadata(projectPath)
    this.debug(options.debug, 'replay:start', {
      projectPath,
      remote,
      branch,
      currentBranch: metadata.currentBranch ?? null,
      headCommit: metadata.headCommit ?? null,
    })
    if (!metadata.isRepo) {
      return {
        success: false,
        remote,
        branch,
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

    const remoteHead =
      (await this.getRevision(projectPath, remoteRef)) ??
      (await this.getRevision(projectPath, 'FETCH_HEAD'))
    if (!remoteHead) {
      return {
        success: false,
        remote,
        branch,
        error: `Remote branch ${remoteRef} does not exist`,
      }
    }

    const workspaceCapture = await this.captureWorkspaceState(projectPath)
    if (!workspaceCapture.success) {
      return {
        success: false,
        remote,
        branch,
        error: workspaceCapture.error,
      }
    }

    const localHead = metadata.headCommit ?? (await this.getRevision(projectPath, 'HEAD'))
    if (!localHead && !workspaceCapture.stashCreated) {
      return {
        success: false,
        remote,
        branch,
        error: 'Local repository does not have work to replay',
      }
    }

    const replayedCommits = localHead
      ? await this.listRevisions(projectPath, ['rev-list', '--reverse', `${remoteRef}..HEAD`])
      : []
    this.debug(options.debug, 'replay:commit_list', {
      projectPath,
      remote,
      branch,
      localHead: localHead ?? null,
      remoteHead,
      stashCreated: workspaceCapture.stashCreated,
      stashCommit: workspaceCapture.stashCommit ?? null,
      replayedCommits,
    })

    const restoreResult = await this.restoreMain(options)
    if (!restoreResult.success) {
      return {
        success: false,
        remote,
        branch,
        error: restoreResult.error,
      }
    }

    const backupBranch = localHead ? `cozea-open-backup-${Date.now()}` : null
    if (backupBranch && localHead) {
      const backupResult = await this.runGit(['branch', backupBranch, localHead], {
        cwd: projectPath,
        timeoutMs: 20_000,
      })
      if (!backupResult.success) {
        return {
          success: false,
          remote,
          branch,
          error: backupResult.error,
        }
      }
    }

    const appliedCommits: string[] = []
    try {
      for (const commit of replayedCommits) {
        const parentCount = await this.getCommitParentCount(projectPath, commit)
        const cherryPickArgs =
          parentCount > 1
            ? ['cherry-pick', '-m', '1', commit]
            : ['cherry-pick', commit]
        const cherryPick = await this.runGit(cherryPickArgs, {
          cwd: projectPath,
          timeoutMs: 120_000,
        })
        if (!cherryPick.success) {
          if (this.isEmptyCherryPickError(cherryPick.error)) {
            const skipResult = await this.runGit(['cherry-pick', '--skip'], {
              cwd: projectPath,
              timeoutMs: 30_000,
            })
            if (!skipResult.success) {
              return {
                success: false,
                remote,
                branch,
                error: skipResult.error,
              }
            }
            continue
          }

          const statusAfterFailure = await this.getStatus({
            projectPath,
            remote,
            branch,
            debug: options.debug,
          })
          const autoResolveResult =
            statusAfterFailure.success && statusAfterFailure.isRepo
              ? await this.tryAutoResolveConflicts({
                  projectPath,
                  remote,
                  branch,
                  conflictedPaths: statusAfterFailure.conflictedPaths ?? [],
                  debug: options.debug,
                })
              : null
          if (autoResolveResult?.success && (autoResolveResult.remainingConflictedPaths?.length ?? 0) === 0) {
            appliedCommits.push(commit)
            continue
          }
          return {
            success: false,
            remote,
            branch,
            currentBranch: await this.getCurrentBranch(projectPath),
            headCommit: await this.getRevision(projectPath, 'HEAD') ?? restoreResult.headCommit,
            replayedCommitCount: appliedCommits.length,
            replayedCommits: appliedCommits,
            hadConflicts:
              Boolean(autoResolveResult?.remainingConflictedPaths?.length) ||
              (statusAfterFailure.success && statusAfterFailure.isRepo && Boolean(statusAfterFailure.hasConflicts)) ||
              /conflict/i.test(cherryPick.error),
            conflictedPaths:
              autoResolveResult?.remainingConflictedPaths ??
              (statusAfterFailure.success && statusAfterFailure.isRepo
                ? statusAfterFailure.conflictedPaths ?? []
                : []),
            error: autoResolveResult?.error || cherryPick.error,
          }
        }
        appliedCommits.push(commit)
      }

      if (workspaceCapture.stashCreated && workspaceCapture.stashRef) {
        const applyCaptureResult = await this.applyCapturedWorkspaceState({
          projectPath,
          remote,
          branch,
          stashRef: workspaceCapture.stashRef,
          stashCommit: workspaceCapture.stashCommit ?? undefined,
          debug: options.debug,
        })
        if (!applyCaptureResult.success) {
          return {
            success: false,
            remote,
            branch,
            currentBranch: await this.getCurrentBranch(projectPath),
            headCommit: await this.getRevision(projectPath, 'HEAD') ?? restoreResult.headCommit,
            replayedCommitCount: appliedCommits.length,
            replayedCommits: appliedCommits,
            hadConflicts: applyCaptureResult.hadConflicts,
            conflictedPaths: applyCaptureResult.conflictedPaths,
            error: applyCaptureResult.error,
          }
        }
      }

      return {
        success: true,
        remote,
        branch,
        currentBranch: await this.getCurrentBranch(projectPath),
        headCommit: await this.getRevision(projectPath, 'HEAD') ?? restoreResult.headCommit,
        replayedCommitCount: appliedCommits.length,
        replayedCommits: appliedCommits,
        hadConflicts: false,
      }
    } finally {
      if (backupBranch && appliedCommits.length === replayedCommits.length) {
        const cleanupResult = await this.runGit(['branch', '-D', backupBranch], {
          cwd: projectPath,
          timeoutMs: 20_000,
        })
        if (!cleanupResult.success) {
          console.warn('[GitSyncService] Failed to delete open replay backup branch:', cleanupResult.error)
        }
      }
    }
  }

  async classifyRepoHealth(options: {
    projectPath: string
    remote?: string
    branch?: string
    debug?: boolean
  }): Promise<GitRepoHealthResult> {
    const projectPath = path.resolve(options.projectPath)
    const remote = this.normalizeRemote(options.remote)
    const branch = this.normalizeBranch(options.branch)
    const remoteRef = `${remote}/${branch}`

    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.repoExists) {
      return {
        success: true,
        health: 'broken',
      }
    }
    if (!metadata.isRepo) {
      return {
        success: true,
        health: 'broken',
      }
    }

    const gitDir = metadata.gitDir ?? path.join(projectPath, '.git')
    if (fs.existsSync(path.join(gitDir, 'index.lock'))) {
      return {
        success: true,
        health: 'index_locked',
        currentBranch: metadata.currentBranch ?? null,
        headCommit: metadata.headCommit,
      }
    }

    const rebaseMergePath = path.join(gitDir, 'rebase-merge')
    const rebaseApplyPath = path.join(gitDir, 'rebase-apply')
    if (fs.existsSync(rebaseMergePath) || fs.existsSync(rebaseApplyPath)) {
      return {
        success: true,
        health: 'rebase_in_progress',
        currentBranch: metadata.currentBranch ?? null,
        headCommit: metadata.headCommit,
      }
    }

    const sequencerState = await this.getSequencerState(projectPath)
    if (sequencerState === 'merge') {
      return {
        success: true,
        health: 'merge_in_progress',
        currentBranch: metadata.currentBranch ?? null,
        headCommit: metadata.headCommit,
      }
    }
    if (sequencerState === 'cherry-pick') {
      return {
        success: true,
        health: 'cherry_pick_in_progress',
        currentBranch: metadata.currentBranch ?? null,
        headCommit: metadata.headCommit,
      }
    }

    if (!metadata.currentBranch && metadata.headCommit) {
      return {
        success: true,
        health: 'detached_head',
        currentBranch: null,
        headCommit: metadata.headCommit,
      }
    }

    const status = await this.getStatus({
      projectPath,
      remote,
      branch,
      debug: options.debug,
    })
    if (!status.success || !status.isRepo) {
      return {
        success: false,
        error: status.error || 'Failed to inspect git status',
      }
    }

    const remoteHead =
      (await this.getRevision(projectPath, remoteRef)) ??
      (await this.getRevision(projectPath, 'FETCH_HEAD'))
    const hasDivergence = Boolean((status.ahead ?? 0) > 0 && (status.behind ?? 0) > 0)
    if (hasDivergence && metadata.headCommit && remoteHead) {
      const mergeBase = await this.getSingleValue(projectPath, ['merge-base', 'HEAD', remoteRef])
      if (!mergeBase) {
        return {
          success: true,
          health: 'unrelated_history',
          currentBranch: metadata.currentBranch ?? null,
          headCommit: metadata.headCommit,
        }
      }
    }

    const hasDirtyWorkspace =
      Boolean(status.hasStagedChanges) ||
      Boolean(status.hasUnstagedChanges) ||
      Boolean(status.hasUntrackedChanges)

    const health = hasDivergence
      ? 'diverged'
      : hasDirtyWorkspace
        ? 'dirty'
        : 'healthy'

    this.debug(options.debug, 'health:result', {
      projectPath,
      remote,
      branch,
      health,
      currentBranch: metadata.currentBranch ?? null,
      headCommit: metadata.headCommit ?? null,
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
      hasDirtyWorkspace,
    })

    return {
      success: true,
      health,
      currentBranch: metadata.currentBranch ?? null,
      headCommit: metadata.headCommit,
    }
  }

  async salvageReclone(options: {
    projectPath: string
    repoUrl: string
    branch?: string
    extraHeader?: string
    provider?: string
    accessToken?: string
    encryptedCredentials?: string
    keyId?: string
    debug?: boolean
  }): Promise<GitSyncSalvageResult> {
    const projectPath = path.resolve(options.projectPath)
    const backupPath = `${projectPath}.cozea-recovery-${Date.now()}`

    try {
      if (fs.existsSync(projectPath)) {
        await fs.promises.rename(projectPath, backupPath)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move existing project aside for recovery',
      }
    }

    const cloneResult = await this.cloneIfMissing({
      projectPath,
      repoUrl: options.repoUrl,
      branch: options.branch,
      extraHeader: this.resolveExtraHeader(options),
      provider: options.provider,
      accessToken: options.accessToken,
      encryptedCredentials: options.encryptedCredentials,
      keyId: options.keyId,
      debug: options.debug,
    })
    if (!cloneResult.success) {
      try {
        if (!fs.existsSync(projectPath) && fs.existsSync(backupPath)) {
          await fs.promises.rename(backupPath, projectPath)
        }
      } catch (restoreError) {
        console.warn('[GitSyncService] Failed to restore backup after salvage clone failure:', restoreError)
      }

      return {
        success: false,
        backupPath,
        error: cloneResult.error || 'Failed to clone project during recovery',
      }
    }

    return {
      success: true,
      localPath: cloneResult.localPath ?? projectPath,
      backupPath,
      currentBranch: cloneResult.currentBranch ?? null,
      headCommit: cloneResult.headCommit,
    }
  }

  async readConflictFile(options: {
    projectPath: string
    filePath: string
  }): Promise<GitConflictFileResult> {
    const projectPath = path.resolve(options.projectPath)
    const filePath = this.normalizeRepoFilePath(options.filePath)
    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return {
        success: false,
        filePath,
        error: 'Project path is not a git repository',
      }
    }

    const status = await this.getStatus({ projectPath })
    if (!status.success || !status.isRepo) {
      return {
        success: false,
        filePath,
        error: status.error || 'Failed to inspect git status',
      }
    }

    const conflictedPaths = status.conflictedPaths ?? []
    if (!conflictedPaths.includes(filePath)) {
      return {
        success: false,
        filePath,
        error: 'File is not currently in conflict',
      }
    }

    try {
      const fullPath = this.resolveRepoRelativePath(projectPath, metadata.topLevelPath ?? projectPath, filePath)
      let currentContent = ''

      try {
        currentContent = await fs.promises.readFile(fullPath, 'utf8')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (code !== 'ENOENT') {
          throw error
        }
      }

      const [baseContent, localContent, cloudContent] = await Promise.all([
        this.getIndexStageContent(projectPath, 1, filePath),
        this.getIndexStageContent(projectPath, 2, filePath),
        this.getIndexStageContent(projectPath, 3, filePath),
      ])

      return {
        success: true,
        filePath,
        currentContent,
        baseContent,
        localContent,
        cloudContent,
      }
    } catch (error) {
      return {
        success: false,
        filePath,
        error: error instanceof Error ? error.message : 'Failed to read conflict file',
      }
    }
  }

  async resolveConflictFile(options: {
    projectPath: string
    filePath: string
    resolvedContent: string
  }): Promise<GitResolveConflictResult> {
    const projectPath = path.resolve(options.projectPath)
    const filePath = this.normalizeRepoFilePath(options.filePath)
    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return {
        success: false,
        filePath,
        error: 'Project path is not a git repository',
      }
    }

    try {
      const repoRoot = metadata.topLevelPath ?? projectPath
      const fullPath = this.resolveRepoRelativePath(projectPath, repoRoot, filePath)
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.promises.writeFile(fullPath, options.resolvedContent, 'utf8')

      const addResult = await this.runGit(['add', '--', filePath], {
        cwd: projectPath,
        timeoutMs: 30_000,
      })
      if (!addResult.success) {
        return {
          success: false,
          filePath,
          error: addResult.error,
        }
      }

      let status = await this.getStatus({ projectPath })
      if (!status.success || !status.isRepo) {
        return {
          success: false,
          filePath,
          error: status.error || 'Failed to verify conflict status after staging',
        }
      }

      let mergeCompleted = false
      if ((status.conflictedPaths?.length ?? 0) === 0) {
        const finalizeResult = await this.finalizeSequencerIfReady(projectPath)
        if (!finalizeResult.success) {
          return {
            success: false,
            filePath,
            error: finalizeResult.error,
          }
        }
        mergeCompleted = true

        if (mergeCompleted) {
          status = await this.getStatus({ projectPath })
          if (!status.success || !status.isRepo) {
            return {
              success: false,
              filePath,
              error: status.error || 'Failed to verify git status after completing merge',
            }
          }
        }
      }

      return {
        success: true,
        filePath,
        remainingConflictedPaths: status.conflictedPaths ?? [],
        mergeCompleted,
      }
    } catch (error) {
      return {
        success: false,
        filePath,
        error: error instanceof Error ? error.message : 'Failed to resolve conflict file',
      }
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
        message: 'bootstrap: remote history',
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
        error: error instanceof Error ? error.message : 'Failed to adopt workspace into remote git',
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

    const commit = await this.runGit(['commit', '-m', options.message.trim() || 'sync: workspace'], {
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

  private normalizeRepoFilePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  }

  private resolveRepoRelativePath(projectPath: string, repoRoot: string, filePath: string): string {
    const resolvedRepoRoot = path.resolve(repoRoot || projectPath)
    const resolvedPath = path.resolve(resolvedRepoRoot, filePath)
    const relativePath = path.relative(resolvedRepoRoot, resolvedPath)
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error('File path must stay within the repository root')
    }
    return resolvedPath
  }

  private async getIndexStageContent(
    projectPath: string,
    stage: 1 | 2 | 3,
    filePath: string
  ): Promise<string | null> {
    const result = await this.runGit(['show', `:${stage}:${filePath}`], {
      cwd: projectPath,
      timeoutMs: 20_000,
    })
    return result.success ? result.stdout : null
  }

  private async getSequencerState(projectPath: string): Promise<'merge' | 'cherry-pick' | null> {
    const result = await this.runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (result.success) {
      return 'merge'
    }

    const cherryPickResult = await this.runGit(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (cherryPickResult.success) {
      return 'cherry-pick'
    }

    return null
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
    const conflictedPaths = new Set<string>()

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
        const isConflict =
          staged === 'U' ||
          unstaged === 'U' ||
          code === 'AA' ||
          code === 'DD'
        hasConflicts = hasConflicts || isConflict
        if (isConflict && normalizedPath) {
          conflictedPaths.add(normalizedPath)
        }
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
      conflictedPaths: Array.from(conflictedPaths),
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

  private isEmptyCherryPickError(error: string | undefined): boolean {
    const message = error?.toLowerCase() ?? ''
    if (!message) {
      return false
    }

    return (
      message.includes('the previous cherry-pick is now empty') ||
      message.includes('nothing to commit') ||
      message.includes('previous cherry-pick is now empty')
    )
  }

  private async listRevisions(projectPath: string, args: string[]): Promise<string[]> {
    const result = await this.runGit(args, {
      cwd: projectPath,
      timeoutMs: 20_000,
    })
    if (!result.success) {
      return []
    }
    return result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
  }

  private async captureWorkspaceState(projectPath: string): Promise<{
    success: boolean
    stashCreated: boolean
    stashRef?: string
    stashCommit?: string
    error?: string
  }> {
    const status = await this.getStatus({ projectPath })
    if (!status.success || !status.isRepo) {
      return {
        success: false,
        stashCreated: false,
        error: status.error || 'Failed to inspect local workspace state',
      }
    }

    const hasDirtyWorkspace =
      Boolean(status.hasStagedChanges) ||
      Boolean(status.hasUnstagedChanges) ||
      Boolean(status.hasUntrackedChanges)
    if (!hasDirtyWorkspace) {
      return {
        success: true,
        stashCreated: false,
      }
    }

    const previousTop = await this.getRevision(projectPath, 'stash@{0}')
    const stashMessage = `cozea-open:${Date.now()}`
    const stashResult = await this.runGit(
      ['stash', 'push', '--include-untracked', '--message', stashMessage],
      {
        cwd: projectPath,
        timeoutMs: 120_000,
      }
    )
    if (!stashResult.success) {
      return {
        success: false,
        stashCreated: false,
        error: stashResult.error,
      }
    }

    const currentTop = await this.getRevision(projectPath, 'stash@{0}')
    if (!currentTop || currentTop === previousTop) {
      return {
        success: true,
        stashCreated: false,
      }
    }

    return {
      success: true,
      stashCreated: true,
      stashRef: 'stash@{0}',
      stashCommit: currentTop,
    }
  }

  private async applyCapturedWorkspaceState(options: {
    projectPath: string
    remote: string
    branch: string
    stashRef: string
    stashCommit?: string
    debug?: boolean
  }): Promise<{
    success: boolean
    hadConflicts: boolean
    conflictedPaths?: string[]
    error?: string
  }> {
    const applyResult = await this.runGit(['stash', 'apply', '--index', options.stashRef], {
      cwd: options.projectPath,
      timeoutMs: 120_000,
    })
    if (!applyResult.success) {
      const statusAfterFailure = await this.getStatus({
        projectPath: options.projectPath,
        remote: options.remote,
        branch: options.branch,
        debug: options.debug,
      })
      const autoResolveResult =
        statusAfterFailure.success && statusAfterFailure.isRepo
          ? await this.tryAutoResolveConflicts({
              projectPath: options.projectPath,
              remote: options.remote,
              branch: options.branch,
              conflictedPaths: statusAfterFailure.conflictedPaths ?? [],
              debug: options.debug,
            })
          : null
      if (autoResolveResult?.success && (autoResolveResult.remainingConflictedPaths?.length ?? 0) === 0) {
        const dropped = await this.dropStashRef(options.projectPath, options.stashRef, options.stashCommit)
        if (!dropped.success) {
          console.warn('[GitSyncService] Failed to drop open replay stash after auto-resolve:', dropped.error)
        }
        return {
          success: true,
          hadConflicts: false,
        }
      }
      return {
        success: false,
        hadConflicts:
          Boolean(autoResolveResult?.remainingConflictedPaths?.length) ||
          (statusAfterFailure.success && statusAfterFailure.isRepo && Boolean(statusAfterFailure.hasConflicts)) ||
          /conflict/i.test(applyResult.error),
        conflictedPaths:
          autoResolveResult?.remainingConflictedPaths ??
          (statusAfterFailure.success && statusAfterFailure.isRepo
            ? statusAfterFailure.conflictedPaths ?? []
            : []),
        error: autoResolveResult?.error || applyResult.error,
      }
    }

    const dropped = await this.dropStashRef(options.projectPath, options.stashRef, options.stashCommit)
    if (!dropped.success) {
      console.warn('[GitSyncService] Failed to drop open replay stash:', dropped.error)
    }

    return {
      success: true,
      hadConflicts: false,
    }
  }

  private async dropStashRef(
    projectPath: string,
    stashRef: string,
    stashCommit?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (stashCommit) {
      const currentTop = await this.getRevision(projectPath, stashRef)
      if (currentTop !== stashCommit) {
        return {
          success: false,
          error: 'Stash stack changed before cleanup',
        }
      }
    }

    const dropResult = await this.runGit(['stash', 'drop', stashRef], {
      cwd: projectPath,
      timeoutMs: 30_000,
    })
    if (!dropResult.success) {
      return {
        success: false,
        error: dropResult.error,
      }
    }

    return { success: true }
  }

  private async tryAutoResolveConflicts(options: {
    projectPath: string
    remote: string
    branch: string
    conflictedPaths: string[]
    debug?: boolean
  }): Promise<{
    success: boolean
    resolvedPaths: string[]
    remainingConflictedPaths: string[]
    error?: string
  }> {
    const resolvedPaths: string[] = []

    for (const filePath of options.conflictedPaths) {
      const resolved = await this.tryAutoResolveConflictPath({
        projectPath: options.projectPath,
        filePath,
      })
      if (!resolved.success) {
        continue
      }
      resolvedPaths.push(filePath)
    }

    let remainingStatus = await this.getStatus({
      projectPath: options.projectPath,
      remote: options.remote,
      branch: options.branch,
      debug: options.debug,
    })
    if (!remainingStatus.success || !remainingStatus.isRepo) {
      return {
        success: false,
        resolvedPaths,
        remainingConflictedPaths: options.conflictedPaths,
        error: remainingStatus.error || 'Failed to verify git status after auto-resolving conflicts',
      }
    }

    if ((remainingStatus.conflictedPaths?.length ?? 0) === 0) {
      const finalizeResult = await this.finalizeSequencerIfReady(options.projectPath)
      if (!finalizeResult.success) {
        return {
          success: false,
          resolvedPaths,
          remainingConflictedPaths: [],
          error: finalizeResult.error,
        }
      }
      remainingStatus = await this.getStatus({
        projectPath: options.projectPath,
        remote: options.remote,
        branch: options.branch,
        debug: options.debug,
      })
      if (!remainingStatus.success || !remainingStatus.isRepo) {
        return {
          success: false,
          resolvedPaths,
          remainingConflictedPaths: [],
          error: remainingStatus.error || 'Failed to verify git status after completing auto-resolve sequencer',
        }
      }
    }

    return {
      success: true,
      resolvedPaths,
      remainingConflictedPaths: remainingStatus.conflictedPaths ?? [],
    }
  }

  private async tryAutoResolveConflictPath(options: {
    projectPath: string
    filePath: string
  }): Promise<{ success: boolean; error?: string }> {
    const filePath = this.normalizeRepoFilePath(options.filePath)
    const baseContent = await this.getIndexStageContent(options.projectPath, 1, filePath)
    const oursContent = await this.getIndexStageContent(options.projectPath, 2, filePath)
    const theirsContent = await this.getIndexStageContent(options.projectPath, 3, filePath)
    const kind = classifyConflictPath(filePath, {
      baseContent,
      oursContent,
      theirsContent,
    })

    if (kind === 'lockfile' || kind === 'generated') {
      return this.checkoutConflictStage({
        projectPath: options.projectPath,
        filePath,
        preferredStage: 'ours',
      })
    }

    if (kind === 'binary') {
      return this.resolveBinaryConflict(options.projectPath, filePath)
    }

    if (kind === 'structured-json') {
      const mergedJson = tryMergeJsonConflict(baseContent, oursContent, theirsContent)
      if (mergedJson != null) {
        return this.writeResolvedConflictFile(options.projectPath, filePath, mergedJson)
      }
    }

    if (kind === 'text' || kind === 'structured-json') {
      const mergeResult = await mergeTextWithGit({
        baseContent: baseContent ?? '',
        localContent: oursContent ?? '',
        cloudContent: theirsContent ?? '',
        labels: {
          local: 'CURRENT',
          base: 'BASE',
          cloud: 'INCOMING',
        },
      })
      if (mergeResult.success && !mergeResult.hasConflicts) {
        return this.writeResolvedConflictFile(options.projectPath, filePath, mergeResult.mergedContent)
      }
    }

    return { success: false }
  }

  private async writeResolvedConflictFile(
    projectPath: string,
    filePath: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const metadata = await this.getRepoMetadata(projectPath)
      if (!metadata.isRepo) {
        return { success: false, error: 'Project path is not a git repository' }
      }
      const repoRoot = metadata.topLevelPath ?? projectPath
      const fullPath = this.resolveRepoRelativePath(projectPath, repoRoot, filePath)
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.promises.writeFile(fullPath, content, 'utf8')
      const addResult = await this.runGit(['add', '--', filePath], {
        cwd: projectPath,
        timeoutMs: 30_000,
      })
      return addResult.success ? { success: true } : { success: false, error: addResult.error }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write resolved conflict file',
      }
    }
  }

  private async checkoutConflictStage(options: {
    projectPath: string
    filePath: string
    preferredStage: 'ours' | 'theirs'
  }): Promise<{ success: boolean; error?: string }> {
    const checkoutPreferred = await this.runGit(
      ['checkout', `--${options.preferredStage}`, '--', options.filePath],
      {
        cwd: options.projectPath,
        timeoutMs: 30_000,
      }
    )
    if (!checkoutPreferred.success) {
      const fallbackStage = options.preferredStage === 'ours' ? 'theirs' : 'ours'
      const checkoutFallback = await this.runGit(
        ['checkout', `--${fallbackStage}`, '--', options.filePath],
        {
          cwd: options.projectPath,
          timeoutMs: 30_000,
        }
      )
      if (!checkoutFallback.success) {
        return { success: false, error: checkoutPreferred.error }
      }
    }

    const addResult = await this.runGit(['add', '--', options.filePath], {
      cwd: options.projectPath,
      timeoutMs: 30_000,
    })
    return addResult.success ? { success: true } : { success: false, error: addResult.error }
  }

  private async resolveBinaryConflict(
    projectPath: string,
    filePath: string
  ): Promise<{ success: boolean; error?: string }> {
    const metadata = await this.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return { success: false, error: 'Project path is not a git repository' }
    }
    const repoRoot = metadata.topLevelPath ?? projectPath
    const fullPath = this.resolveRepoRelativePath(projectPath, repoRoot, filePath)
    const conflictCopyPath = this.buildBinaryConflictCopyPath(fullPath)

    const checkoutTheirs = await this.runGit(['checkout', '--theirs', '--', filePath], {
      cwd: projectPath,
      timeoutMs: 30_000,
    })
    if (!checkoutTheirs.success) {
      return { success: false, error: checkoutTheirs.error }
    }

    await fs.promises.mkdir(path.dirname(conflictCopyPath), { recursive: true })
    await fs.promises.copyFile(fullPath, conflictCopyPath)

    const checkoutOurs = await this.runGit(['checkout', '--ours', '--', filePath], {
      cwd: projectPath,
      timeoutMs: 30_000,
    })
    if (!checkoutOurs.success) {
      return { success: false, error: checkoutOurs.error }
    }

    const conflictCopyRelativePath = path.relative(repoRoot, conflictCopyPath).replace(/\\/g, '/')
    const addResult = await this.runGit(['add', '--', filePath, conflictCopyRelativePath], {
      cwd: projectPath,
      timeoutMs: 30_000,
    })
    return addResult.success ? { success: true } : { success: false, error: addResult.error }
  }

  private buildBinaryConflictCopyPath(fullPath: string): string {
    const parsed = path.parse(fullPath)
    let candidate = path.join(parsed.dir, `${parsed.name}.local-conflict${parsed.ext}`)
    let suffix = 1
    while (fs.existsSync(candidate)) {
      candidate = path.join(parsed.dir, `${parsed.name}.local-conflict-${suffix}${parsed.ext}`)
      suffix += 1
    }
    return candidate
  }

  private async finalizeSequencerIfReady(projectPath: string): Promise<{ success: boolean; error?: string }> {
    const sequencerState = await this.getSequencerState(projectPath)
    if (sequencerState === 'merge') {
      const commitResult = await this.runGit(['commit', '--no-edit'], {
        cwd: projectPath,
        timeoutMs: 120_000,
      })
      return commitResult.success ? { success: true } : { success: false, error: commitResult.error }
    }
    if (sequencerState === 'cherry-pick') {
      const continueResult = await this.runGit(['cherry-pick', '--continue'], {
        cwd: projectPath,
        timeoutMs: 120_000,
      })
      return continueResult.success ? { success: true } : { success: false, error: continueResult.error }
    }
    return { success: true }
  }

  private async getCommitParentCount(projectPath: string, commit: string): Promise<number> {
    const result = await this.runGit(['rev-list', '--parents', '-n', '1', commit], {
      cwd: projectPath,
      timeoutMs: 10_000,
    })
    if (!result.success) {
      return 1
    }

    const parts = result.stdout.trim().split(/\s+/).filter(Boolean)
    return Math.max(0, parts.length - 1)
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
