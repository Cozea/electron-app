import { spawnSync } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
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
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  }
}

function isTimestampServiceUnavailable(details) {
  return /timestamp service is not available/i.test(details)
}

function isCI() {
  return process.env.CI === 'true'
}

function resolveCodesignIdentity() {
  const explicitIdentity = (process.env.COZEA_CODESIGN_IDENTITY ?? process.env.CSC_NAME ?? '').trim()
  if (explicitIdentity) return explicitIdentity

  const lookup = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (!lookup.ok) return ''

  const developerIdLine = lookup.stdout
    .split('\n')
    .find((line) => line.includes('Developer ID Application:'))
  if (!developerIdLine) return ''

  const identityMatch = developerIdLine.match(/"([^"]+)"/)
  return identityMatch?.[1] ?? ''
}

function isMachO(filePath) {
  const probe = run('file', ['-b', filePath])
  if (!probe.ok) return false
  return /Mach-O/i.test(probe.stdout)
}

async function collectFiles(rootDir) {
  const files = []
  const queue = [rootDir]
  while (queue.length > 0) {
    const current = queue.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }
      if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }
  return files
}

function signBinary(filePath, identity) {
  const baseArgs = ['--force', '--sign', identity, '--options', 'runtime']
  const maxTimestampAttempts = Number.parseInt(process.env.COZEA_CODESIGN_TIMESTAMP_RETRIES ?? '3', 10)
  const timestampAttempts = Number.isFinite(maxTimestampAttempts)
    ? Math.max(1, Math.min(maxTimestampAttempts, 10))
    : 3
  let lastTimestampError = ''

  for (let attempt = 1; attempt <= timestampAttempts; attempt += 1) {
    const timestampResult = run('codesign', [...baseArgs, '--timestamp', filePath])
    if (timestampResult.ok) return

    const details = timestampResult.stderr.trim()
    if (!isTimestampServiceUnavailable(details)) {
      throw new Error(`Failed to sign ${filePath}: ${details}`)
    }

    lastTimestampError = details
    if (attempt < timestampAttempts) {
      log(`Timestamp service unavailable while signing ${filePath}; retry ${attempt}/${timestampAttempts} failed.`)
    }
  }

  log(`Timestamp service unavailable for ${filePath}; signing without timestamp as fallback.`)
  const fallbackResult = run('codesign', [...baseArgs, filePath])
  if (!fallbackResult.ok) {
    throw new Error(
      `Failed to sign ${filePath} without timestamp (timestamp_error="${lastTimestampError}", fallback_error="${fallbackResult.stderr.trim()}")`
    )
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

async function signDarwinTargetBinaries(target) {
  if (process.platform !== 'darwin' || !target.id.startsWith('darwin-')) return

  const identity = resolveCodesignIdentity()
  if (!identity) {
    if (isCI()) {
      throw new Error(
        `No Developer ID codesigning identity available while building bundled git archive for ${target.id}`
      )
    }
    log(`No Developer ID identity found; skipping codesign pass for ${target.id}`)
    return
  }

  const targetDir = path.join(bundledGitRoot, target.id)
  const files = await collectFiles(targetDir)
  let signedCount = 0

  for (const filePath of files) {
    if (!isMachO(filePath)) continue
    signBinary(filePath, identity)
    signedCount += 1
  }

  log(`Signed ${signedCount} Mach-O binaries for ${target.id}`)
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
    await signDarwinTargetBinaries(target)
    await archiveTarget(target)
  }
}

main().catch((error) => {
  console.error(`[git-bundle-archives] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
