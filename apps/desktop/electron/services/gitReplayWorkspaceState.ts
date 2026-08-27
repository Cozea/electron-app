import fs from 'node:fs'
import path from 'node:path'

import type { GitCommandResult } from '../gitRuntime'
import { mergeTextWithGit } from '../gitRuntime'
import type { GitSyncStatusResult } from '../../../../shared/electronApiTypes'
import { classifyConflictPath, tryMergeJsonConflict } from './gitConflictHeuristics'
import type { RepoMetadata } from './gitSyncShared'

interface GitReplayRunOptions {
  cwd: string
  timeoutMs: number
}

interface GitReplayStatusOptions {
  projectPath: string
  remote?: string
  branch?: string
  debug?: boolean
}

interface GitReplayHelpers {
  getStatus: (options: GitReplayStatusOptions) => Promise<GitSyncStatusResult>
  getRevision: (projectPath: string, ref: string) => Promise<string | null>
  getRepoMetadata: (projectPath: string) => Promise<RepoMetadata>
  getIndexStageContent: (
    projectPath: string,
    stage: 1 | 2 | 3,
    filePath: string
  ) => Promise<string | null>
  getSequencerState: (projectPath: string) => Promise<'merge' | 'cherry-pick' | null>
  normalizeRepoFilePath: (filePath: string) => string
  resolveRepoRelativePath: (projectPath: string, repoRoot: string, filePath: string) => string
  runGit: (args: string[], options: GitReplayRunOptions) => Promise<GitCommandResult>
}

export async function captureWorkspaceState(
  projectPath: string,
  helpers: Pick<GitReplayHelpers, 'getRevision' | 'getStatus' | 'runGit'>
): Promise<{
  success: boolean
  stashCreated: boolean
  stashRef?: string
  stashCommit?: string
  error?: string
}> {
  const status = await helpers.getStatus({ projectPath })
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

  const previousTop = await helpers.getRevision(projectPath, 'stash@{0}')
  const stashMessage = `cozea-open:${Date.now()}`
  const stashResult = await helpers.runGit(
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

  const currentTop = await helpers.getRevision(projectPath, 'stash@{0}')
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

export async function applyCapturedWorkspaceState(
  options: {
    projectPath: string
    remote: string
    branch: string
    stashRef: string
    stashCommit?: string
    debug?: boolean
  },
  helpers: GitReplayHelpers
): Promise<{
  success: boolean
  hadConflicts: boolean
  conflictedPaths?: string[]
  error?: string
}> {
  const applyResult = await helpers.runGit(['stash', 'apply', '--index', options.stashRef], {
    cwd: options.projectPath,
    timeoutMs: 120_000,
  })
  if (!applyResult.success) {
    const statusAfterFailure = await helpers.getStatus({
      projectPath: options.projectPath,
      remote: options.remote,
      branch: options.branch,
      debug: options.debug,
    })
    const autoResolveResult =
      statusAfterFailure.success && statusAfterFailure.isRepo
        ? await tryAutoResolveConflicts(
            {
              projectPath: options.projectPath,
              remote: options.remote,
              branch: options.branch,
              conflictedPaths: statusAfterFailure.conflictedPaths ?? [],
              debug: options.debug,
            },
            helpers
          )
        : null
    if (autoResolveResult?.success && (autoResolveResult.remainingConflictedPaths?.length ?? 0) === 0) {
      const dropped = await dropStashRef(options.projectPath, options.stashRef, options.stashCommit, helpers)
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
        /conflict/i.test(applyResult.error ?? ''),
      conflictedPaths:
        autoResolveResult?.remainingConflictedPaths ??
        (statusAfterFailure.success && statusAfterFailure.isRepo
          ? statusAfterFailure.conflictedPaths ?? []
          : []),
      error: autoResolveResult?.error || applyResult.error,
    }
  }

  const dropped = await dropStashRef(options.projectPath, options.stashRef, options.stashCommit, helpers)
  if (!dropped.success) {
    console.warn('[GitSyncService] Failed to drop open replay stash:', dropped.error)
  }

  return {
    success: true,
    hadConflicts: false,
  }
}

export async function tryAutoResolveConflicts(
  options: {
    projectPath: string
    remote: string
    branch: string
    conflictedPaths: string[]
    debug?: boolean
  },
  helpers: GitReplayHelpers
): Promise<{
  success: boolean
  resolvedPaths: string[]
  remainingConflictedPaths: string[]
  error?: string
}> {
  const resolvedPaths: string[] = []

  for (const filePath of options.conflictedPaths) {
    const resolved = await tryAutoResolveConflictPath(
      {
        projectPath: options.projectPath,
        filePath,
      },
      helpers
    )
    if (!resolved.success) {
      continue
    }
    resolvedPaths.push(filePath)
  }

  let remainingStatus = await helpers.getStatus({
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
    const finalizeResult = await finalizeSequencerIfReady(options.projectPath, helpers)
    if (!finalizeResult.success) {
      return {
        success: false,
        resolvedPaths,
        remainingConflictedPaths: [],
        error: finalizeResult.error,
      }
    }
    remainingStatus = await helpers.getStatus({
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

export async function finalizeSequencerIfReady(
  projectPath: string,
  helpers: Pick<GitReplayHelpers, 'getSequencerState' | 'runGit'>
): Promise<{ success: boolean; error?: string }> {
  const sequencerState = await helpers.getSequencerState(projectPath)
  if (sequencerState === 'merge') {
    const commitResult = await helpers.runGit(['commit', '--no-edit'], {
      cwd: projectPath,
      timeoutMs: 120_000,
    })
    return commitResult.success ? { success: true } : { success: false, error: commitResult.error }
  }
  if (sequencerState === 'cherry-pick') {
    const continueResult = await helpers.runGit(['cherry-pick', '--continue'], {
      cwd: projectPath,
      timeoutMs: 120_000,
    })
    return continueResult.success ? { success: true } : { success: false, error: continueResult.error }
  }
  return { success: true }
}

async function dropStashRef(
  projectPath: string,
  stashRef: string,
  stashCommit: string | undefined,
  helpers: Pick<GitReplayHelpers, 'getRevision' | 'runGit'>
): Promise<{ success: boolean; error?: string }> {
  if (stashCommit) {
    const currentTop = await helpers.getRevision(projectPath, stashRef)
    if (currentTop !== stashCommit) {
      return {
        success: false,
        error: 'Stash stack changed before cleanup',
      }
    }
  }

  const dropResult = await helpers.runGit(['stash', 'drop', stashRef], {
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

async function tryAutoResolveConflictPath(
  options: {
    projectPath: string
    filePath: string
  },
  helpers: GitReplayHelpers
): Promise<{ success: boolean; error?: string }> {
  const filePath = helpers.normalizeRepoFilePath(options.filePath)
  const baseContent = await helpers.getIndexStageContent(options.projectPath, 1, filePath)
  const oursContent = await helpers.getIndexStageContent(options.projectPath, 2, filePath)
  const theirsContent = await helpers.getIndexStageContent(options.projectPath, 3, filePath)
  const kind = classifyConflictPath(filePath, {
    baseContent,
    oursContent,
    theirsContent,
  })

  if (kind === 'lockfile' || kind === 'generated') {
    return checkoutConflictStage(
      {
        projectPath: options.projectPath,
        filePath,
        preferredStage: 'ours',
      },
      helpers
    )
  }

  if (kind === 'binary') {
    return resolveBinaryConflict(options.projectPath, filePath, helpers)
  }

  if (kind === 'structured-json') {
    const mergedJson = tryMergeJsonConflict(baseContent, oursContent, theirsContent)
    if (mergedJson != null) {
      return writeResolvedConflictFile(options.projectPath, filePath, mergedJson, helpers)
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
      return writeResolvedConflictFile(options.projectPath, filePath, mergeResult.mergedContent, helpers)
    }
  }

  return { success: false }
}

async function writeResolvedConflictFile(
  projectPath: string,
  filePath: string,
  content: string,
  helpers: Pick<GitReplayHelpers, 'getRepoMetadata' | 'resolveRepoRelativePath' | 'runGit'>
): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await helpers.getRepoMetadata(projectPath)
    if (!metadata.isRepo) {
      return { success: false, error: 'Project path is not a git repository' }
    }
    const repoRoot = metadata.topLevelPath ?? projectPath
    const fullPath = helpers.resolveRepoRelativePath(projectPath, repoRoot, filePath)
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.writeFile(fullPath, content, 'utf8')
    const addResult = await helpers.runGit(['add', '--', filePath], {
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

async function checkoutConflictStage(
  options: {
    projectPath: string
    filePath: string
    preferredStage: 'ours' | 'theirs'
  },
  helpers: Pick<GitReplayHelpers, 'runGit'>
): Promise<{ success: boolean; error?: string }> {
  const checkoutPreferred = await helpers.runGit(
    ['checkout', `--${options.preferredStage}`, '--', options.filePath],
    {
      cwd: options.projectPath,
      timeoutMs: 30_000,
    }
  )
  if (!checkoutPreferred.success) {
    const fallbackStage = options.preferredStage === 'ours' ? 'theirs' : 'ours'
    const checkoutFallback = await helpers.runGit(
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

  const addResult = await helpers.runGit(['add', '--', options.filePath], {
    cwd: options.projectPath,
    timeoutMs: 30_000,
  })
  return addResult.success ? { success: true } : { success: false, error: addResult.error }
}

async function resolveBinaryConflict(
  projectPath: string,
  filePath: string,
  helpers: Pick<GitReplayHelpers, 'getRepoMetadata' | 'resolveRepoRelativePath' | 'runGit'>
): Promise<{ success: boolean; error?: string }> {
  const metadata = await helpers.getRepoMetadata(projectPath)
  if (!metadata.isRepo) {
    return { success: false, error: 'Project path is not a git repository' }
  }
  const repoRoot = metadata.topLevelPath ?? projectPath
  const fullPath = helpers.resolveRepoRelativePath(projectPath, repoRoot, filePath)
  const conflictCopyPath = buildBinaryConflictCopyPath(fullPath)

  const checkoutTheirs = await helpers.runGit(['checkout', '--theirs', '--', filePath], {
    cwd: projectPath,
    timeoutMs: 30_000,
  })
  if (!checkoutTheirs.success) {
    return { success: false, error: checkoutTheirs.error }
  }

  await fs.promises.mkdir(path.dirname(conflictCopyPath), { recursive: true })
  await fs.promises.copyFile(fullPath, conflictCopyPath)

  const checkoutOurs = await helpers.runGit(['checkout', '--ours', '--', filePath], {
    cwd: projectPath,
    timeoutMs: 30_000,
  })
  if (!checkoutOurs.success) {
    return { success: false, error: checkoutOurs.error }
  }

  const conflictCopyRelativePath = path.relative(repoRoot, conflictCopyPath).replace(/\\/g, '/')
  const addResult = await helpers.runGit(['add', '--', filePath, conflictCopyRelativePath], {
    cwd: projectPath,
    timeoutMs: 30_000,
  })
  return addResult.success ? { success: true } : { success: false, error: addResult.error }
}

function buildBinaryConflictCopyPath(fullPath: string): string {
  const parsed = path.parse(fullPath)
  let candidate = path.join(parsed.dir, `${parsed.name}.local-conflict${parsed.ext}`)
  let suffix = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}.local-conflict-${suffix}${parsed.ext}`)
    suffix += 1
  }
  return candidate
}
