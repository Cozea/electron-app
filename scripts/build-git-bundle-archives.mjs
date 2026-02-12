import { spawnSync } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundledGitRoot = path.join(rootDir, 'build', 'git')
const archiveRoot = path.join(bundledGitRoot, 'packs')

const requestedTargetIds = new Set()
const targets = [
  { id: 'darwin-arm64', binaryRelPath: 'bin/git' },
  { id: 'darwin-x64', binaryRelPath: 'bin/git' },
  { id: 'win32-arm64', binaryRelPath: 'cmd/git.exe' },
  { id: 'win32-x64', binaryRelPath: 'cmd/git.exe' },
]

function log(message) {
  console.log(`[git-bundle-archives] ${message}`)
}

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    stderr: result.stderr ?? result.error?.message ?? '',
  }
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function parseRequestedTargets() {
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (current === '--target') {
      const next = args[index + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value for --target')
      }
      requestedTargetIds.add(next.trim())
      index += 1
      continue
    }
    if (current.startsWith('--target=')) {
      const value = current.slice('--target='.length).trim()
      if (!value) throw new Error('Missing value for --target')
      requestedTargetIds.add(value)
    }
  }

  const envTargets = (process.env.COZEA_GIT_BUNDLE_ARCHIVE_TARGETS ?? process.env.COZEA_GIT_BUNDLE_TARGETS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const envTarget of envTargets) {
    requestedTargetIds.add(envTarget)
  }
}

function getRequestedTargets() {
  if (requestedTargetIds.size > 0) {
    return Array.from(requestedTargetIds).map((targetId) => {
      const target = targets.find((entry) => entry.id === targetId)
      if (!target) {
        const validTargets = targets.map((entry) => entry.id).join(', ')
        throw new Error(`Unknown target "${targetId}". Valid targets: ${validTargets}`)
      }
      return target
    })
  }

  const nativeId = `${process.platform}-${process.arch}`
  const nativeTarget = targets.find((target) => target.id === nativeId)
  return nativeTarget ? [nativeTarget] : []
}

async function validateTargetBinary(target) {
  const binaryPath = path.join(bundledGitRoot, target.id, target.binaryRelPath)
  if (!(await exists(binaryPath))) {
    throw new Error(`Bundled Git binary is missing for ${target.id}: ${binaryPath}`)
  }
}

async function archiveTarget(target) {
  const targetDir = path.join(bundledGitRoot, target.id)
  const archivePath = path.join(archiveRoot, `git-bundle-${target.id}.tar.gz`)
  await mkdir(archiveRoot, { recursive: true })

  const result = run('tar', ['-czf', archivePath, '-C', targetDir, '.'])
  if (!result.ok) {
    throw new Error(`Failed to archive ${target.id}: ${result.stderr.trim()}`)
  }

  log(`Built ${archivePath}`)
}

async function main() {
  parseRequestedTargets()
  const selectedTargets = getRequestedTargets()
  if (selectedTargets.length === 0) {
    log(`No supported target for ${process.platform}-${process.arch}; skipping archive build`)
    return
  }

  for (const target of selectedTargets) {
    await validateTargetBinary(target)
    await archiveTarget(target)
  }
}

main().catch((error) => {
  console.error(`[git-bundle-archives] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
