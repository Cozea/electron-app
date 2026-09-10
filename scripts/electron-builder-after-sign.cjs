const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function log(message) {
  console.log(`[afterPack:pack-sign] ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || result.error?.message || '').trim()
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`)
  }
  return result
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function extractProcessDetails(result) {
  return (result.stderr || result.stdout || result.error?.message || '').trim()
}

function isTimestampServiceUnavailable(details) {
  return /timestamp service is not available/i.test(details)
}

function detectArchiveType(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tar.gz')) return 'tar.gz'
  if (lower.endsWith('.tgz')) return 'tgz'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.zip')) return 'zip'
  return null
}

async function exists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectFiles(rootDir) {
  const files = []
  const queue = [rootDir]
  while (queue.length > 0) {
    const current = queue.pop()
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolutePath)
        continue
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(absolutePath)
      }
    }
  }
  return files
}

async function collectArchives(rootDir) {
  if (!(await exists(rootDir))) return []
  const allFiles = await collectFiles(rootDir)
  return allFiles.filter((filePath) => detectArchiveType(filePath) !== null)
}

function isMachO(filePath) {
  const result = tryRun('file', ['-b', filePath])
  if (result.status !== 0) return false
  return /Mach-O/i.test(result.stdout || '')
}

function extractArchive(archivePath, extractDir, archiveType) {
  if (archiveType === 'tar.gz' || archiveType === 'tgz') {
    run('tar', ['-xzf', archivePath, '-C', extractDir])
    return
  }
  if (archiveType === 'tar') {
    run('tar', ['-xf', archivePath, '-C', extractDir])
    return
  }
  if (archiveType === 'zip') {
    run('unzip', ['-qq', archivePath, '-d', extractDir])
    return
  }
  throw new Error(`Unsupported archive type for ${archivePath}`)
}

function repackArchive(archivePath, extractDir, archiveType) {
  const tmpArchivePath = `${archivePath}.tmp-${Date.now()}`
  if (archiveType === 'tar.gz' || archiveType === 'tgz') {
    run('tar', ['-czf', tmpArchivePath, '-C', extractDir, '.'])
  } else if (archiveType === 'tar') {
    run('tar', ['-cf', tmpArchivePath, '-C', extractDir, '.'])
  } else if (archiveType === 'zip') {
    run('zip', ['-qry', tmpArchivePath, '.'], { cwd: extractDir })
  } else {
    throw new Error(`Unsupported archive type for ${archivePath}`)
  }
  fs.renameSync(tmpArchivePath, archivePath)
}

function signBinary(filePath, identity) {
  const baseArgs = ['--force', '--sign', identity, '--options', 'runtime']
  const maxTimestampAttempts = Number.parseInt(process.env.COZEA_CODESIGN_TIMESTAMP_RETRIES ?? '3', 10)
  const timestampAttempts = Number.isFinite(maxTimestampAttempts)
    ? Math.max(1, Math.min(maxTimestampAttempts, 10))
    : 3
  let lastTimestampDetails = ''

  for (let attempt = 1; attempt <= timestampAttempts; attempt += 1) {
    const result = tryRun('codesign', [...baseArgs, '--timestamp', filePath])
    if (result.status === 0) return

    const details = extractProcessDetails(result)
    if (!isTimestampServiceUnavailable(details)) {
      throw new Error(`codesign ${[...baseArgs, '--timestamp', filePath].join(' ')} failed: ${details}`)
    }

    lastTimestampDetails = details
    if (attempt < timestampAttempts) {
      log(
        `Timestamp service unavailable while signing ${filePath}; retry ${attempt}/${timestampAttempts} failed, retrying.`
      )
    }
  }

  log(
    `Timestamp service unavailable after ${timestampAttempts} attempts for ${filePath}; retrying without timestamp.`
  )
  const noTimestampResult = tryRun('codesign', [...baseArgs, filePath])
  if (noTimestampResult.status !== 0) {
    const noTimestampDetails = extractProcessDetails(noTimestampResult)
    throw new Error(
      `codesign failed for ${filePath} (timestamp_details="${lastTimestampDetails}", no_timestamp_details="${noTimestampDetails}")`
    )
  }
}

function resolveIdentity(context) {
  const explicitIdentity = process.env.COZEA_CODESIGN_IDENTITY?.trim() || process.env.CSC_NAME?.trim()
  if (explicitIdentity) return explicitIdentity

  const identityFromBuilder =
    typeof context?.packager?.platformSpecificBuildOptions?.identity === 'string'
      ? context.packager.platformSpecificBuildOptions.identity.trim()
      : ''
  if (identityFromBuilder) return identityFromBuilder

  const identitiesResult = tryRun('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (identitiesResult.status !== 0) return ''

  const lines = (identitiesResult.stdout || '').split('\n')
  const developerIdLine = lines.find((line) => line.includes('Developer ID Application:'))
  if (!developerIdLine) return ''

  const quotedIdentity = developerIdLine.match(/"([^"]+)"/)
  return quotedIdentity?.[1] ?? ''
}

async function processArchive(archivePath, identity) {
  const archiveType = detectArchiveType(archivePath)
  if (!archiveType) return { changed: false, signedCount: 0 }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cozea-pack-sign-'))
  const extractDir = path.join(tempRoot, 'contents')
  await fsp.mkdir(extractDir, { recursive: true })

  let changed = false
  let signedCount = 0

  try {
    extractArchive(archivePath, extractDir, archiveType)
    const extractedFiles = await collectFiles(extractDir)

    for (const filePath of extractedFiles) {
      const stat = await fsp.lstat(filePath)
      if (!stat.isFile()) continue

      const nestedArchiveType = detectArchiveType(filePath)
      if (nestedArchiveType) {
        const nestedResult = await processArchive(filePath, identity)
        if (nestedResult.changed) changed = true
        signedCount += nestedResult.signedCount
        continue
      }

      if (!isMachO(filePath)) continue
      signBinary(filePath, identity)
      changed = true
      signedCount += 1
    }

    if (changed) {
      repackArchive(archivePath, extractDir, archiveType)
    }
    return { changed, signedCount }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
}

async function findAppBundles(appOutDir) {
  const entries = await fsp.readdir(appOutDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(appOutDir, entry.name))
}

/**
 * Give an unsigned build a valid ad-hoc signature.
 *
 * With `identity: null`, electron-builder skips signing altogether, which
 * leaves the bundle with no `Contents/_CodeSignature` while the inner Mach-O
 * still carries its linker signature. macOS reads that mismatch as a broken
 * bundle: `codesign --verify` reports "code has no resources but signature
 * indicates they must be present", and Gatekeeper refuses to open the app as
 * "damaged", which right-click Open cannot get past.
 *
 * An ad-hoc signature needs no certificate and no Apple membership. It only
 * makes the bundle internally consistent, restoring the ordinary unsigned
 * experience: macOS warns that the developer is unverified, and the user can
 * open it anyway.
 */
/**
 * Whether this build is the deliberately unsigned one.
 *
 * Mirrors the flag electron-builder.config.cjs reads to set `identity: null`.
 * The identity this hook can resolve from the local keychain says nothing
 * about whether electron-builder is going to sign.
 */
function isUnsignedBuild() {
  return (
    process.env.COZEA_LOCAL_UNSIGNED_DIST === '1' || process.env.COZEA_MAC_SIGNING === '0'
  )
}

async function adhocSignAppBundles(appOutDir) {
  const appBundles = await findAppBundles(appOutDir)
  if (appBundles.length === 0) {
    log('No app bundle found to ad-hoc sign.')
    return
  }

  for (const appBundlePath of appBundles) {
    run('codesign', ['--force', '--deep', '--sign', '-', appBundlePath])
    run('codesign', ['--verify', '--deep', '--strict', appBundlePath])
    log(`Ad-hoc signed and verified ${path.basename(appBundlePath)}`)
  }
}

module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') {
    return
  }

  const appOutDir = context?.appOutDir
  if (!appOutDir) {
    log('No appOutDir available in afterSign context, skipping git pack signing.')
    return
  }

  // electron-builder skips signing outright when identity is null, so the
  // bundle would ship with no seal at all. Give it an ad-hoc one instead.
  if (isUnsignedBuild()) {
    await adhocSignAppBundles(appOutDir)
    return
  }

  const identity = resolveIdentity(context)
  if (!identity) {
    const allowUnsignedBundlesInCI = process.env.COZEA_ALLOW_UNSIGNED_GIT_BUNDLES === '1'
    if (process.env.CI === 'true' && !allowUnsignedBundlesInCI) {
      throw new Error('No Developer ID identity available to sign bundled git pack binaries.')
    }
    log('No codesigning identity found, skipping git pack signing.')
    return
  }

  const appBundles = await findAppBundles(appOutDir)
  if (appBundles.length === 0) {
    log(`No .app bundles found in ${appOutDir}, skipping git pack signing.`)
    return
  }

  let archiveCount = 0
  let changedArchiveCount = 0
  let signedBinaryCount = 0

  for (const appBundlePath of appBundles) {
    const resourcesPath = path.join(appBundlePath, 'Contents', 'Resources')
    const archiveRoots = [path.join(resourcesPath, 'git', 'packs')]

    for (const archiveRoot of archiveRoots) {
      const archives = await collectArchives(archiveRoot)
      for (const archivePath of archives) {
        archiveCount += 1
        const result = await processArchive(archivePath, identity)
        signedBinaryCount += result.signedCount
        if (result.changed) changedArchiveCount += 1
      }
    }
  }

  log(
    `Git pack signing complete. scanned_archives=${archiveCount}, updated_archives=${changedArchiveCount}, signed_binaries=${signedBinaryCount}`
  )
}
