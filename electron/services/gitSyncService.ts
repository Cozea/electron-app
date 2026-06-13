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
import {
  commitAndPush as runCommitAndPushWorkflow,
  fetchMain as runFetchMainWorkflow,
  pullMain as runPullMainWorkflow,
  pushMain as runPushMainWorkflow,
} from './gitRemoteSync'
import {
  applyCapturedWorkspaceState as runApplyCapturedWorkspaceState,
  captureWorkspaceState as runCaptureWorkspaceState,
  finalizeSequencerIfReady as runFinalizeSequencerIfReady,
  tryAutoResolveConflicts as runTryAutoResolveConflicts,
} from './gitReplayWorkspaceState'
import {
  DEFAULT_GIT_USER_EMAIL,
  DEFAULT_GIT_USER_NAME,
  DEFAULT_REMOTE,
  isEmptyCherryPickError,
  isMissingRemoteBranchError,
  normalizeGitBranch,
  normalizeGitRemote,
  normalizeGitRemoteUrl,
  parseGitStatus,
  type RepoMetadata,
} from './gitSyncShared'
import { runGitCommand } from '../gitRuntime'

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

export class GitSyncService {
  private static instance: GitSyncService

  static getInstance(): GitSyncService {
    if (!GitSyncService.instance) {
      GitSyncService.instance = new GitSyncService()
    }
    return GitSyncService.instance
  }

  private constructor() {}

  private debug(enabled: boolean | undefined, _event: string, _payload: Record<string, unknown>): void {
    if (!enabled) {
      return
    }

    // console.info(`[GitOpenDebug][Main] ${_event}`, _payload)
  }

  async ensureRepo(options: {
    projectPath: string
    branch?: string
    repoUrl?: string
    debug?: boolean
  }): Promise<GitSyncEnsureRepoResult> {
    const branch = normalizeGitBranch(options.branch)
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
        const remoteResult = await this.setRemoteUrl(projectPath, normalizeGitRemoteUrl(options.repoUrl))
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
    const branch = normalizeGitBranch(options.branch)
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
      const cloneArgs = ['clone', '--branch', branch, '--single-branch', normalizeGitRemoteUrl(options.repoUrl), projectPath]
      let clone = await this.runGit(cloneArgs, {
        cwd: parentDir,
        extraHeader: this.resolveExtraHeader(options),
        timeoutMs: 120_000,
      })
      if (!clone.success && isMissingRemoteBranchError(clone.error)) {
        clone = await this.runGit(['clone', normalizeGitRemoteUrl(options.repoUrl), projectPath], {
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
    return runFetchMainWorkflow(options, {
      debug: this.debug.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      setRemoteUrl: this.setRemoteUrl.bind(this),
      resolveExtraHeader: this.resolveExtraHeader.bind(this),
      runGit: this.runGit.bind(this),
      getRevision: this.getRevision.bind(this),
      getCurrentBranch: this.getCurrentBranch.bind(this),
      getStatus: this.getStatus.bind(this),
      restoreMain: this.restoreMain.bind(this),
      adoptWorkspace: this.adoptWorkspace.bind(this),
      commitAll: this.commitAll.bind(this),
    })
  }

  async getStatus(options: {
    projectPath: string
    remote?: string
    branch?: string
    debug?: boolean
  }): Promise<GitSyncStatusResult> {
    const remote = normalizeGitRemote(options.remote)
    const branch = normalizeGitBranch(options.branch)
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
    const parsed = parseGitStatus(status.stdout)
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
    return runPullMainWorkflow(options, {
      debug: this.debug.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      setRemoteUrl: this.setRemoteUrl.bind(this),
      resolveExtraHeader: this.resolveExtraHeader.bind(this),
      runGit: this.runGit.bind(this),
      getRevision: this.getRevision.bind(this),
      getCurrentBranch: this.getCurrentBranch.bind(this),
      getStatus: this.getStatus.bind(this),
      restoreMain: this.restoreMain.bind(this),
      adoptWorkspace: this.adoptWorkspace.bind(this),
      commitAll: this.commitAll.bind(this),
    })
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
    const remote = normalizeGitRemote(options.remote)
    const branch = normalizeGitBranch(options.branch)
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
      const remoteResult = await this.setRemoteUrl(projectPath, normalizeGitRemoteUrl(options.repoUrl))
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
          if (isEmptyCherryPickError(cherryPick.error)) {
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
              /conflict/i.test(cherryPick.error ?? ''),
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
    const remote = normalizeGitRemote(options.remote)
    const branch = normalizeGitBranch(options.branch)
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
    const remote = normalizeGitRemote(options.remote)
    const branch = normalizeGitBranch(options.branch)
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
      const remoteResult = await this.setRemoteUrl(projectPath, normalizeGitRemoteUrl(options.repoUrl))
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
    const branch = normalizeGitBranch(options.branch)
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
        const remoteResult = await this.setRemoteUrl(projectPath, normalizeGitRemoteUrl(options.repoUrl))
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
    return runPushMainWorkflow(options, {
      debug: this.debug.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      setRemoteUrl: this.setRemoteUrl.bind(this),
      resolveExtraHeader: this.resolveExtraHeader.bind(this),
      runGit: this.runGit.bind(this),
      getRevision: this.getRevision.bind(this),
      getCurrentBranch: this.getCurrentBranch.bind(this),
      getStatus: this.getStatus.bind(this),
      restoreMain: this.restoreMain.bind(this),
      adoptWorkspace: this.adoptWorkspace.bind(this),
      commitAll: this.commitAll.bind(this),
    })
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
    return runCommitAndPushWorkflow(options, {
      debug: this.debug.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      setRemoteUrl: this.setRemoteUrl.bind(this),
      resolveExtraHeader: this.resolveExtraHeader.bind(this),
      runGit: this.runGit.bind(this),
      getRevision: this.getRevision.bind(this),
      getCurrentBranch: this.getCurrentBranch.bind(this),
      getStatus: this.getStatus.bind(this),
      restoreMain: this.restoreMain.bind(this),
      adoptWorkspace: this.adoptWorkspace.bind(this),
      commitAll: this.commitAll.bind(this),
    })
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

  private repoMetadataCache = new Map<string, { ts: number; data: Promise<RepoMetadata> }>()

  private async getRepoMetadata(projectPath: string): Promise<RepoMetadata> {
    const cached = this.repoMetadataCache.get(projectPath)
    if (cached && Date.now() - cached.ts < 500) {
      return cached.data
    }

    const promise = (async () => {
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
    })();

    this.repoMetadataCache.set(projectPath, { ts: Date.now(), data: promise })
    return promise
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
    return runCaptureWorkspaceState(projectPath, {
      getStatus: this.getStatus.bind(this),
      getRevision: this.getRevision.bind(this),
      runGit: this.runGit.bind(this),
    })
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
    return runApplyCapturedWorkspaceState(options, {
      getStatus: this.getStatus.bind(this),
      getRevision: this.getRevision.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      getIndexStageContent: this.getIndexStageContent.bind(this),
      getSequencerState: this.getSequencerState.bind(this),
      normalizeRepoFilePath: this.normalizeRepoFilePath.bind(this),
      resolveRepoRelativePath: this.resolveRepoRelativePath.bind(this),
      runGit: this.runGit.bind(this),
    })
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
    return runTryAutoResolveConflicts(options, {
      getStatus: this.getStatus.bind(this),
      getRevision: this.getRevision.bind(this),
      getRepoMetadata: this.getRepoMetadata.bind(this),
      getIndexStageContent: this.getIndexStageContent.bind(this),
      getSequencerState: this.getSequencerState.bind(this),
      normalizeRepoFilePath: this.normalizeRepoFilePath.bind(this),
      resolveRepoRelativePath: this.resolveRepoRelativePath.bind(this),
      runGit: this.runGit.bind(this),
    })
  }

  private async finalizeSequencerIfReady(projectPath: string): Promise<{ success: boolean; error?: string }> {
    return runFinalizeSequencerIfReady(projectPath, {
      getSequencerState: this.getSequencerState.bind(this),
      runGit: this.runGit.bind(this),
    })
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
