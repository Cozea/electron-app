import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const CHECKPOINT_REF_PREFIX = 'refs/cozea/checkpoints'
const DEFAULT_AUTHOR_EMAIL = 'cozea@users.noreply.github.com'

interface GitExecuteOptions {
  cwd: string
  args: string[]
  env?: NodeJS.ProcessEnv
  allowNonZeroExit?: boolean
}

interface GitExecuteResult {
  stdout: string
  stderr: string
  code: number
}

interface SyntheticCommitInput {
  cwd: string
  authorName: string
  authorEmail?: string
}

export interface GitCheckpointCaptureResult {
  success: boolean
  ref?: string
  commitOid?: string
  error?: string
}

export interface GitCheckpointDiffResult {
  success: boolean
  diff?: string
  error?: string
}

export interface GitCheckpointFilePairResult {
  success: boolean
  previousContent?: string
  nextContent?: string
  error?: string
}

export interface GitCheckpointDeleteResult {
  success: boolean
  deletedRefs?: string[]
  error?: string
}

export interface GitCheckpointHeadStatsResult {
  success: boolean
  additions: number
  deletions: number
  changedFiles: number
  error?: string
}

async function executeGit(options: GitExecuteOptions): Promise<GitExecuteResult> {
  return await new Promise((resolve) => {
    const proc = spawn('git', options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 })
    })

    proc.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, code: 1 })
    })
  })
}

function checkpointRefForId(checkpointId: string): string {
  return `${CHECKPOINT_REF_PREFIX}/${checkpointId}`
}

async function assertGitSuccess(
  options: GitExecuteOptions,
  errorMessage: string,
): Promise<GitExecuteResult> {
  const result = await executeGit(options)
  if (result.code !== 0 && options.allowNonZeroExit !== true) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || errorMessage)
  }
  return result
}

async function resolveHeadCommit(cwd: string): Promise<string | null> {
  const result = await executeGit({
    cwd,
    args: ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
    allowNonZeroExit: true,
  })
  if (result.code !== 0) {
    return null
  }
  const commit = result.stdout.trim()
  return commit.length > 0 ? commit : null
}

async function resolveCheckpointCommit(cwd: string, ref: string): Promise<string | null> {
  const result = await executeGit({
    cwd,
    args: ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    allowNonZeroExit: true,
  })
  if (result.code !== 0) {
    return null
  }
  const commit = result.stdout.trim()
  return commit.length > 0 ? commit : null
}

async function readGitObjectText(cwd: string, objectRef: string): Promise<string | null> {
  const result = await executeGit({
    cwd,
    args: ['show', objectRef],
    allowNonZeroExit: true,
  })
  if (result.code !== 0) {
    return null
  }
  return result.stdout
}

async function createSyntheticCommit(input: SyntheticCommitInput): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-checkpoint-'))

  try {
    const tempIndexPath = path.join(tempDir, `index-${crypto.randomUUID()}`)
    const commitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
      GIT_AUTHOR_NAME: input.authorName,
      GIT_AUTHOR_EMAIL: input.authorEmail ?? DEFAULT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: input.authorName,
      GIT_COMMITTER_EMAIL: input.authorEmail ?? DEFAULT_AUTHOR_EMAIL,
    }

    const headCommit = await resolveHeadCommit(input.cwd)
    if (headCommit) {
      await assertGitSuccess(
        {
          cwd: input.cwd,
          args: ['read-tree', 'HEAD'],
          env: commitEnv,
        },
        'Failed to seed temporary git index from HEAD.',
      )
    }

    await assertGitSuccess(
      {
        cwd: input.cwd,
        args: ['add', '-A', '--', '.'],
        env: commitEnv,
      },
      'Failed to stage workspace into temporary git index.',
    )

    const writeTreeResult = await assertGitSuccess(
      {
        cwd: input.cwd,
        args: ['write-tree'],
        env: commitEnv,
      },
      'Failed to write temporary git tree.',
    )
    const treeOid = writeTreeResult.stdout.trim()
    if (!treeOid) {
      throw new Error('Temporary git tree oid was empty.')
    }

    const commitArgs = ['commit-tree', treeOid, '-m', `cozea checkpoint ${crypto.randomUUID()}`]
    if (headCommit) {
      commitArgs.splice(2, 0, '-p', headCommit)
    }
    const commitResult = await assertGitSuccess(
      {
        cwd: input.cwd,
        args: commitArgs,
        env: commitEnv,
      },
      'Failed to create temporary checkpoint commit.',
    )
    const commitOid = commitResult.stdout.trim()
    if (!commitOid) {
      throw new Error('Temporary checkpoint commit oid was empty.')
    }

    return commitOid
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function resolveDiffEndpoints(input: {
  cwd: string
  fromRef?: string | null
  toRef: string
}): Promise<{ fromCommit: string; toCommit: string }> {
  const toCommit = await resolveCheckpointCommit(input.cwd, input.toRef)
  if (!toCommit) {
    throw new Error(`Checkpoint ref '${input.toRef}' is unavailable.`)
  }

  if (input.fromRef) {
    const fromCommit = await resolveCheckpointCommit(input.cwd, input.fromRef)
    if (!fromCommit) {
      throw new Error(`Checkpoint ref '${input.fromRef}' is unavailable.`)
    }
    return { fromCommit, toCommit }
  }

  const headCommit = await resolveHeadCommit(input.cwd)
  return {
    fromCommit: headCommit ?? EMPTY_TREE_SHA,
    toCommit,
  }
}

function parseShortstat(stdout: string): GitCheckpointHeadStatsResult {
  const line = stdout.trim()
  if (!line) {
    return {
      success: true,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
  }

  const changedFilesMatch = line.match(/(\d+)\s+files?\s+changed/)
  const additionsMatch = line.match(/(\d+)\s+insertions?\(\+\)/)
  const deletionsMatch = line.match(/(\d+)\s+deletions?\(-\)/)

  return {
    success: true,
    changedFiles: changedFilesMatch ? Number.parseInt(changedFilesMatch[1], 10) : 0,
    additions: additionsMatch ? Number.parseInt(additionsMatch[1], 10) : 0,
    deletions: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
  }
}

export async function captureCheckpoint(
  cwd: string,
  checkpointId: string,
  authorName: string,
  authorEmail = DEFAULT_AUTHOR_EMAIL,
): Promise<GitCheckpointCaptureResult> {
  try {
    const commitOid = await createSyntheticCommit({
      cwd,
      authorName,
      authorEmail,
    })
    const ref = checkpointRefForId(checkpointId)
    await assertGitSuccess(
      {
        cwd,
        args: ['update-ref', ref, commitOid],
      },
      `Failed to update checkpoint ref '${ref}'.`,
    )

    return {
      success: true,
      ref,
      commitOid,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture checkpoint.',
    }
  }
}

export async function diffCheckpoints(args: {
  cwd: string
  fromCheckpointId?: string | null
  toCheckpointId: string
  filePath?: string
}): Promise<GitCheckpointDiffResult> {
  try {
    const fromRef = args.fromCheckpointId ? checkpointRefForId(args.fromCheckpointId) : null
    const toRef = checkpointRefForId(args.toCheckpointId)
    const { fromCommit, toCommit } = await resolveDiffEndpoints({
      cwd: args.cwd,
      fromRef,
      toRef,
    })

    const diffArgs = ['diff', '--patch', '--minimal', '--no-color', fromCommit, toCommit]
    if (args.filePath?.trim()) {
      diffArgs.push('--', args.filePath.trim())
    }
    const result = await assertGitSuccess(
      {
        cwd: args.cwd,
        args: diffArgs,
      },
      'Failed to compute checkpoint diff.',
    )

    return {
      success: true,
      diff: result.stdout,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compute checkpoint diff.',
    }
  }
}

export async function readCheckpointFilePair(args: {
  cwd: string
  fromCheckpointId?: string | null
  toCheckpointId: string
  filePath: string
}): Promise<GitCheckpointFilePairResult> {
  try {
    const toRef = checkpointRefForId(args.toCheckpointId)
    const { fromCommit, toCommit } = await resolveDiffEndpoints({
      cwd: args.cwd,
      fromRef: args.fromCheckpointId ? checkpointRefForId(args.fromCheckpointId) : null,
      toRef,
    })

    const normalizedPath = args.filePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const previousContent = (await readGitObjectText(args.cwd, `${fromCommit}:${normalizedPath}`)) ?? ''
    const nextContent = (await readGitObjectText(args.cwd, `${toCommit}:${normalizedPath}`)) ?? ''

    return {
      success: true,
      previousContent,
      nextContent,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read checkpoint file pair.',
    }
  }
}

export async function deleteCheckpointRefs(args: {
  cwd: string
  checkpointIds: string[]
}): Promise<GitCheckpointDeleteResult> {
  try {
    const deletedRefs: string[] = []
    for (const checkpointId of args.checkpointIds) {
      const ref = checkpointRefForId(checkpointId)
      const result = await executeGit({
        cwd: args.cwd,
        args: ['update-ref', '-d', ref],
        allowNonZeroExit: true,
      })
      if (result.code === 0) {
        deletedRefs.push(ref)
      }
    }

    return {
      success: true,
      deletedRefs,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete checkpoint refs.',
    }
  }
}

export async function deleteAllCheckpointRefs(cwd: string): Promise<GitCheckpointDeleteResult> {
  try {
    const refsResult = await assertGitSuccess(
      {
        cwd,
        args: ['for-each-ref', '--format=%(refname)', CHECKPOINT_REF_PREFIX],
      },
      'Failed to enumerate checkpoint refs.',
    )

    const refs = refsResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (refs.length === 0) {
      return {
        success: true,
        deletedRefs: [],
      }
    }

    const deletedRefs: string[] = []
    for (const ref of refs) {
      const result = await executeGit({
        cwd,
        args: ['update-ref', '-d', ref],
        allowNonZeroExit: true,
      })
      if (result.code === 0) {
        deletedRefs.push(ref)
      }
    }

    return {
      success: true,
      deletedRefs,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete checkpoint refs.',
    }
  }
}

export async function getHeadDiffStats(
  cwd: string,
  authorName = 'Cozea',
): Promise<GitCheckpointHeadStatsResult> {
  try {
    const syntheticCommit = await createSyntheticCommit({
      cwd,
      authorName,
    })
    const headCommit = await resolveHeadCommit(cwd)
    const diffTarget = headCommit ?? EMPTY_TREE_SHA
    const result = await assertGitSuccess(
      {
        cwd,
        args: ['diff', '--shortstat', diffTarget, syntheticCommit],
      },
      'Failed to compute head diff stats.',
    )
    return parseShortstat(result.stdout)
  } catch (error) {
    return {
      success: false,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      error: error instanceof Error ? error.message : 'Failed to compute head diff stats.',
    }
  }
}
