import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { app } from 'electron'

interface GitExecuteOptions {
  cwd: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

async function executeGit(options: GitExecuteOptions): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // If not packaged, rely on system git (for now). Ideally we'd use the bundled git path from gitRuntime.ts
    // but assuming system 'git' is available for simplicity.
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

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 })
    })
  })
}

export async function captureCheckpoint(cwd: string, eventId: string, authorName: string, authorEmail: string = 't3code@users.noreply.github.com'): Promise<{ success: boolean; error?: string; commitOid?: string }> {
  const tempDir = path.join(app.getPath('temp'), `cozea-checkpoint-${crypto.randomUUID()}`)
  
  try {
    await fs.mkdir(tempDir, { recursive: true })
    const tempIndexPath = path.join(tempDir, 'index')
    
    const commitEnv: NodeJS.ProcessEnv = {
      GIT_INDEX_FILE: tempIndexPath,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail,
    }

    // 1. Read existing HEAD into temp index (if exists)
    const headCheck = await executeGit({ cwd, args: ['rev-parse', '--verify', 'HEAD'] })
    if (headCheck.code === 0) {
      await executeGit({ cwd, args: ['read-tree', 'HEAD'], env: commitEnv })
    }

    // 2. Add all pending changes
    await executeGit({ cwd, args: ['add', '-A', '--', '.'], env: commitEnv })

    // 3. Write tree
    const treeResult = await executeGit({ cwd, args: ['write-tree'], env: commitEnv })
    if (treeResult.code !== 0) return { success: false, error: 'Failed to write tree' }
    const treeOid = treeResult.stdout.trim()

    // 4. Commit tree
    const message = `t3 checkpoint ref=${eventId}`
    const commitResult = await executeGit({ cwd, args: ['commit-tree', treeOid, '-m', message], env: commitEnv })
    if (commitResult.code !== 0) return { success: false, error: 'Failed to commit tree' }
    const commitOid = commitResult.stdout.trim()

    // 5. Update ref
    const refPath = `refs/cozea/checkpoints/${eventId}`
    const updateRefResult = await executeGit({ cwd, args: ['update-ref', refPath, commitOid] })
    if (updateRefResult.code !== 0) return { success: false, error: 'Failed to update ref' }

    return { success: true, commitOid }
  } catch (error: any) {
    return { success: false, error: error.message }
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  }
}

export async function diffCheckpoints(cwd: string, fromRef: string, toRef: string | null = null): Promise<{ success: boolean; diff?: string; error?: string }> {
  // If toRef is null, we are diffing against HEAD
  // If fromRef is null, we assume we are diffing from HEAD.
  // Actually, we want to see the diff OF a checkpoint against its parent?
  // Let's assume we diff `fromCommitOid` (e.g. HEAD) to `toCommitOid` (the checkpoint).
  
  const fromCommitResult = await executeGit({ cwd, args: ['rev-parse', '--verify', '--quiet', `${fromRef}^{commit}`] })
  let fromCommitOid = fromCommitResult.code === 0 ? fromCommitResult.stdout.trim() : null
  
  if (!fromCommitOid) {
    const headResult = await executeGit({ cwd, args: ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'] })
    if (headResult.code === 0) fromCommitOid = headResult.stdout.trim()
  }

  if (!fromCommitOid) {
     // Empty repo case, diffing against empty tree
     fromCommitOid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // empty tree SHA
  }

  const toArgs = toRef ? ['rev-parse', '--verify', '--quiet', `${toRef}^{commit}`] : ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']
  const toCommitResult = await executeGit({ cwd, args: toArgs })
  let toCommitOid = toCommitResult.code === 0 ? toCommitResult.stdout.trim() : null

  if (!toCommitOid) {
    return { success: false, error: 'Target ref unavailable' }
  }

  const diffResult = await executeGit({ cwd, args: ['diff', '--patch', '--minimal', '--no-color', fromCommitOid, toCommitOid] })
  return { success: true, diff: diffResult.stdout }
}

export async function getHeadDiffStats(cwd: string): Promise<{ success: boolean; additions?: number; deletions?: number; error?: string }> {
  // Check if we have HEAD
  const headCheck = await executeGit({ cwd, args: ['rev-parse', '--verify', 'HEAD'] })
  if (headCheck.code !== 0) {
     // No head, probably fresh repo. Get stats using empty tree.
     const emptyTreeDiff = await executeGit({ cwd, args: ['diff', '--shortstat', '4b825dc642cb6eb9a060e54bf8d69288fbee4904'] })
     return parseShortstat(emptyTreeDiff.stdout)
  }

  // Get diff against HEAD (including untracked files by adding them to temp index first? No, 
  // git diff HEAD doesn't include untracked unless added. We only want uncommitted stats.
  // Actually, we can run `git add -N .` then `git diff HEAD --shortstat` or we can use our checkpoint tree.)
  // T3 might just do `git diff HEAD --shortstat`. But if files are untracked, they don't show.
  // The easiest way is to use our own `captureCheckpoint` implicitly? 
  // Or just use `git diff HEAD --shortstat` to be simple for now. 
  
  const diffResult = await executeGit({ cwd, args: ['diff', 'HEAD', '--shortstat'] })
  return parseShortstat(diffResult.stdout)
}

function parseShortstat(stdout: string): { success: boolean, additions: number, deletions: number } {
  const line = stdout.trim()
  if (!line) return { success: true, additions: 0, deletions: 0 }
  
  const additionsMatch = line.match(/(\d+) insertion/)
  const deletionsMatch = line.match(/(\d+) deletion/)
  
  const additions = additionsMatch ? parseInt(additionsMatch[1], 10) : 0
  const deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
  
  return { success: true, additions, deletions }
}
