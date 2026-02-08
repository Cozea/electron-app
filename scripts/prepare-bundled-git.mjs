import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundledGitRoot = path.join(rootDir, 'build', 'git')

const gitForWindowsLatestReleaseApi =
  'https://api.github.com/repos/git-for-windows/git/releases/latest'
const gitCoreTagsApi = 'https://api.github.com/repos/git/git/tags?per_page=20'

const targets = [
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64', binaryRelPath: 'bin/git' },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64', binaryRelPath: 'bin/git' },
  { id: 'win32-x64', platform: 'win32', arch: 'x64', binaryRelPath: 'cmd/git.exe' },
  { id: 'win32-arm64', platform: 'win32', arch: 'arm64', binaryRelPath: 'cmd/git.exe' },
]

const checkOnly = process.argv.includes('--check')
const requireAll = process.argv.includes('--all') || process.env.COZEA_GIT_BUNDLE_REQUIRE === 'all'
const requestedTargetIds = new Set()

function log(message) {
  console.log(`[bundled-git] ${message}`)
}

function warn(message) {
  console.warn(`[bundled-git] WARN: ${message}`)
}

function fail(message) {
  console.error(`[bundled-git] ERROR: ${message}`)
}

function parseRequestedTargetIds() {
  const cliArgs = process.argv.slice(2)
  for (let index = 0; index < cliArgs.length; index += 1) {
    const current = cliArgs[index]
    if (current === '--target') {
      const next = cliArgs[index + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value for --target. Example: --target darwin-arm64')
      }
      requestedTargetIds.add(next.trim())
      index += 1
      continue
    }

    if (current.startsWith('--target=')) {
      const value = current.slice('--target='.length).trim()
      if (!value) {
        throw new Error('Missing value for --target. Example: --target=darwin-arm64')
      }
      requestedTargetIds.add(value)
    }
  }

  const envTargets = (process.env.COZEA_GIT_BUNDLE_TARGETS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const envTarget of envTargets) {
    requestedTargetIds.add(envTarget)
  }
}

function envKeyForTarget(target) {
  return `COZEA_GIT_BUNDLE_URL_${target.id.toUpperCase().replace(/-/g, '_')}`
}

function getTargetDir(target) {
  return path.join(bundledGitRoot, target.id)
}

function getBinaryPath(target) {
  return path.join(getTargetDir(target), target.binaryRelPath)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf-8',
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    error: result.error ? String(result.error.message || result.error) : null,
  }
}

function hasGitOption(helpText, optionName) {
  const escapedOption = optionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const directPattern = new RegExp(`--${escapedOption}\\b`)
  const toggledPattern = new RegExp(`--\\[no-\\]${escapedOption}\\b`)
  return directPattern.test(helpText) || toggledPattern.test(helpText)
}

async function downloadFile(url, destinationPath) {
  const headers = {
    Accept: 'application/vnd.github+json,application/octet-stream',
    'User-Agent': 'cozea-bundled-git-bootstrap',
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }

  await mkdir(path.dirname(destinationPath), { recursive: true })
  const body = Readable.fromWeb(response.body)
  await pipeline(body, fs.createWriteStream(destinationPath))
}

async function restoreGitkeep(target) {
  const gitkeepPath = path.join(getTargetDir(target), path.dirname(target.binaryRelPath), '.gitkeep')
  await mkdir(path.dirname(gitkeepPath), { recursive: true })
  if (!(await exists(gitkeepPath))) {
    await fs.promises.writeFile(gitkeepPath, '')
  }
}

async function flattenSingleNestedRoot(target) {
  const targetDir = getTargetDir(target)
  if (await exists(getBinaryPath(target))) {
    return
  }

  const entries = await readdir(targetDir, { withFileTypes: true })
  const visibleEntries = entries.filter((entry) => entry.name !== '.DS_Store')
  if (visibleEntries.length !== 1 || !visibleEntries[0].isDirectory()) {
    return
  }

  const nestedRoot = path.join(targetDir, visibleEntries[0].name)
  const nestedBinary = path.join(nestedRoot, target.binaryRelPath)
  if (!(await exists(nestedBinary))) {
    return
  }

  const nestedChildren = await readdir(nestedRoot)
  for (const child of nestedChildren) {
    await rename(path.join(nestedRoot, child), path.join(targetDir, child))
  }
  await rm(nestedRoot, { recursive: true, force: true })
}

function escapePowerShellLiteral(input) {
  return input.replace(/'/g, "''")
}

function extractArchiveWithTar(archivePath, destinationPath, extraFlags = []) {
  const args = [...extraFlags, '-f', archivePath, '-C', destinationPath]
  const tarResult = run('tar', args)
  if (!tarResult.ok) {
    throw new Error(tarResult.error || tarResult.stderr || `tar extraction failed for ${archivePath}`)
  }
}

function extractArchiveWithPowerShell(archivePath, destinationPath) {
  const command = `Expand-Archive -Path '${escapePowerShellLiteral(
    archivePath
  )}' -DestinationPath '${escapePowerShellLiteral(destinationPath)}' -Force`
  const result = run('powershell', ['-NoProfile', '-Command', command])
  if (!result.ok) {
    throw new Error(result.error || result.stderr || `Expand-Archive failed for ${archivePath}`)
  }
}

function extractArchiveWithUnzip(archivePath, destinationPath) {
  const unzipResult = run('unzip', ['-q', archivePath, '-d', destinationPath])
  if (!unzipResult.ok) {
    throw new Error(unzipResult.error || unzipResult.stderr || `unzip failed for ${archivePath}`)
  }
}

async function extractArchive(archivePath, target) {
  const targetDir = getTargetDir(target)
  const hadGitkeep = await exists(path.join(targetDir, path.dirname(target.binaryRelPath), '.gitkeep'))

  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })

  const normalizedArchive = archivePath.toLowerCase()
  if (normalizedArchive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      extractArchiveWithPowerShell(archivePath, targetDir)
    } else {
      try {
        extractArchiveWithUnzip(archivePath, targetDir)
      } catch (error) {
        warn(`unzip unavailable, retrying zip extraction via tar: ${String(error)}`)
        extractArchiveWithTar(archivePath, targetDir, ['-x'])
      }
    }
  } else if (normalizedArchive.endsWith('.tar.gz') || normalizedArchive.endsWith('.tgz')) {
    extractArchiveWithTar(archivePath, targetDir, ['-x', '-z'])
  } else if (normalizedArchive.endsWith('.tar.bz2') || normalizedArchive.endsWith('.tbz2')) {
    extractArchiveWithTar(archivePath, targetDir, ['-x', '-j'])
  } else if (normalizedArchive.endsWith('.tar.xz') || normalizedArchive.endsWith('.txz')) {
    extractArchiveWithTar(archivePath, targetDir, ['-x', '-J'])
  } else {
    extractArchiveWithTar(archivePath, targetDir, ['-x'])
  }

  await flattenSingleNestedRoot(target)

  if (hadGitkeep) {
    await restoreGitkeep(target)
  }
}

async function hydrateFromArchiveInput(target, archiveInput, sourceLabel) {
  const tempDir = path.join(os.tmpdir(), `cozea-git-bundle-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempDir, { recursive: true })

  try {
    const isRemote = /^https?:\/\//i.test(archiveInput)
    const archivePath = isRemote
      ? path.join(
          tempDir,
          path.basename(new URL(archiveInput).pathname) || `${target.id}-bundle.archive`
        )
      : path.resolve(archiveInput)

    if (isRemote) {
      log(`Downloading ${sourceLabel} for ${target.id}`)
      await downloadFile(archiveInput, archivePath)
    }

    if (!(await exists(archivePath))) {
      throw new Error(`Archive not found: ${archivePath}`)
    }

    log(`Extracting ${sourceLabel} for ${target.id}`)
    await extractArchive(archivePath, target)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function getNativeTarget() {
  const id = `${process.platform}-${process.arch}`
  return targets.find((target) => target.id === id) || null
}

function getRequiredTargets() {
  if (requestedTargetIds.size > 0) {
    const selectedTargets = []
    for (const requestedTargetId of requestedTargetIds) {
      const matched = targets.find((target) => target.id === requestedTargetId)
      if (!matched) {
        const valid = targets.map((target) => target.id).join(', ')
        throw new Error(`Unknown target "${requestedTargetId}". Valid targets: ${valid}`)
      }
      selectedTargets.push(matched)
    }
    return selectedTargets
  }

  if (requireAll) {
    return [...targets]
  }
  const nativeTarget = getNativeTarget()
  return nativeTarget ? [nativeTarget] : []
}

async function fetchLatestGitForWindowsRelease() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cozea-bundled-git-bootstrap',
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`
  }

  const response = await fetch(gitForWindowsLatestReleaseApi, { headers })
  if (!response.ok) {
    throw new Error(`Failed to query Git for Windows release feed (${response.status})`)
  }

  return response.json()
}

async function fetchLatestGitCoreTag() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cozea-bundled-git-bootstrap',
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`
  }

  const response = await fetch(gitCoreTagsApi, { headers })
  if (!response.ok) {
    throw new Error(`Failed to query git/git tags feed (${response.status})`)
  }

  const tags = await response.json()
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('git/git tags feed returned no tags')
  }
  const stableTag = tags.find((entry) => typeof entry?.name === 'string' && /^v\d+\.\d+\.\d+$/.test(entry.name))
  const tagName = String(stableTag?.name || tags[0]?.name || '').trim()
  if (!tagName) {
    throw new Error('Unable to resolve git source tag from git/git tags feed')
  }
  return tagName
}

function pickGitForWindowsAsset(release, target) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const minGitPattern = target.arch === 'arm64' ? /^MinGit-.*-arm64\.zip$/ : /^MinGit-.*-64-bit\.zip$/
  const standardGitPattern =
    target.arch === 'arm64' ? /^Git-.*-arm64\.tar\.bz2$/ : /^Git-.*-64-bit\.tar\.bz2$/

  return (
    assets.find((asset) => typeof asset?.name === 'string' && minGitPattern.test(asset.name) && !asset.name.includes('busybox')) ||
    assets.find((asset) => typeof asset?.name === 'string' && standardGitPattern.test(asset.name)) ||
    null
  )
}

async function hydrateWindowsTargetFromGitForWindows(target) {
  const release = await fetchLatestGitForWindowsRelease()
  const asset = pickGitForWindowsAsset(release, target)
  if (!asset?.browser_download_url) {
    throw new Error(`No compatible Git for Windows asset found for ${target.id}`)
  }

  const releaseName = String(release?.tag_name || release?.name || 'latest')
  await hydrateFromArchiveInput(
    target,
    asset.browser_download_url,
    `git-for-windows ${releaseName} (${asset.name})`
  )
}

function requireTool(command, guidance) {
  const result = run(command, ['--version'])
  if (!result.ok) {
    throw new Error(guidance)
  }
}

async function hydrateDarwinTargetFromSource(target) {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Cannot auto-build ${target.id} on ${process.platform}. Set ${envKeyForTarget(target)} to a prepared archive.`
    )
  }

  if (process.arch !== target.arch) {
    throw new Error(
      `Cannot auto-build ${target.id} on ${process.platform}-${process.arch}. Build on a ${target.arch} Mac or set ${envKeyForTarget(target)}.`
    )
  }

  requireTool(
    'xcode-select',
    'xcode-select is missing. Install Xcode Command Line Tools with: xcode-select --install'
  )
  requireTool('make', 'make is missing. Install Xcode Command Line Tools with: xcode-select --install')
  requireTool('tar', 'tar is missing from this machine.')

  const tag = await fetchLatestGitCoreTag()
  const sourceTarballUrl = `https://codeload.github.com/git/git/tar.gz/refs/tags/${tag}`

  const tempDir = path.join(os.tmpdir(), `cozea-git-source-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const sourceArchive = path.join(tempDir, 'git-source.tar.gz')
  const sourceDir = path.join(tempDir, 'src')
  await mkdir(sourceDir, { recursive: true })

  try {
    log(`Downloading git source ${tag} for ${target.id}`)
    await downloadFile(sourceTarballUrl, sourceArchive)
    extractArchiveWithTar(sourceArchive, sourceDir, ['-x', '-z'])

    const entries = await readdir(sourceDir, { withFileTypes: true })
    const sourceRootEntry = entries.find((entry) => entry.isDirectory())
    if (!sourceRootEntry) {
      throw new Error('Unable to locate extracted git source directory')
    }

    const sourceRoot = path.join(sourceDir, sourceRootEntry.name)
    const targetDir = getTargetDir(target)
    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })

    const jobs = Math.max(1, os.cpus().length)
    log(`Building git ${tag} for ${target.id} (jobs=${jobs})`)

    const configureResult = run('make', ['configure'], { cwd: sourceRoot })
    if (!configureResult.ok) {
      throw new Error(configureResult.error || configureResult.stderr || 'make configure failed')
    }

    const configured = run('sh', ['./configure', `--prefix=${targetDir}`, '--without-tcltk'], {
      cwd: sourceRoot,
    })
    if (!configured.ok) {
      throw new Error(configured.error || configured.stderr || './configure failed')
    }

    const buildArgs = [
      `-j${jobs}`,
      'NO_GETTEXT=YesPlease',
      'NO_TCLTK=YesPlease',
      'NO_PERL=YesPlease',
      'NO_PYTHON=YesPlease',
    ]
    const built = run('make', buildArgs, { cwd: sourceRoot })
    if (!built.ok) {
      throw new Error(built.error || built.stderr || 'make build failed')
    }

    const installed = run('make', ['install', ...buildArgs.slice(1)], { cwd: sourceRoot })
    if (!installed.ok) {
      throw new Error(installed.error || installed.stderr || 'make install failed')
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function validateBinaryPresence(target) {
  const binaryPath = getBinaryPath(target)
  if (!(await exists(binaryPath))) {
    throw new Error(`Missing bundled Git binary for ${target.id}: ${binaryPath}`)
  }
}

function validateNativeCapabilities(target) {
  const binaryPath = getBinaryPath(target)
  log(`Validating runtime capabilities for ${target.id}`)

  const versionResult = run(binaryPath, ['--version'])
  if (!versionResult.ok) {
    throw new Error(versionResult.error || versionResult.stderr || `Unable to execute ${binaryPath} --version`)
  }

  const mergeFileHelp = run(binaryPath, ['merge-file', '-h'])
  const mergeTreeHelp = run(binaryPath, ['merge-tree', '-h'])
  const mergeFileText = `${mergeFileHelp.stdout}\n${mergeFileHelp.stderr}`
  const mergeTreeText = `${mergeTreeHelp.stdout}\n${mergeTreeHelp.stderr}`

  if (!hasGitOption(mergeFileText, 'zdiff3')) {
    throw new Error(`Bundled Git ${target.id} does not support merge-file --zdiff3`)
  }
  if (!hasGitOption(mergeTreeText, 'write-tree')) {
    throw new Error(`Bundled Git ${target.id} does not support merge-tree --write-tree`)
  }

  log(`${target.id} runtime OK (${versionResult.stdout.trim()})`)
}

async function hydrateTarget(target) {
  const configuredArchive = process.env[envKeyForTarget(target)]?.trim()
  if (configuredArchive) {
    await hydrateFromArchiveInput(target, configuredArchive, `configured archive (${envKeyForTarget(target)})`)
    return
  }

  if (target.platform === 'win32') {
    await hydrateWindowsTargetFromGitForWindows(target)
    return
  }

  if (target.platform === 'darwin') {
    await hydrateDarwinTargetFromSource(target)
    return
  }

  throw new Error(
    `No archive configured for ${target.id}. Set ${envKeyForTarget(target)} to a tar/zip URL or local archive path.`
  )
}

async function main() {
  parseRequestedTargetIds()
  log(`Preparing bundled Git runtimes in ${bundledGitRoot}`)
  const requiredTargets = getRequiredTargets()

  if (requiredTargets.length === 0) {
    warn(
      `No supported host target for this machine (${process.platform}-${process.arch}). Set COZEA_GIT_BUNDLE_REQUIRE=all to validate all runtime folders.`
    )
    return
  }

  await mkdir(bundledGitRoot, { recursive: true })

  for (const target of requiredTargets) {
    const binaryPath = getBinaryPath(target)
    const present = await exists(binaryPath)
    if (present || checkOnly) {
      continue
    }

    log(`Bundled Git missing for ${target.id} (${binaryPath})`)
    await hydrateTarget(target)
  }

  for (const target of requiredTargets) {
    await validateBinaryPresence(target)
  }

  const nativeTarget = getNativeTarget()
  if (nativeTarget && requiredTargets.some((target) => target.id === nativeTarget.id)) {
    validateNativeCapabilities(nativeTarget)
  }

  const summary = requiredTargets.map((target) => `${target.id}: ${getBinaryPath(target)}`).join(', ')
  if (checkOnly) {
    log(`Check complete (${summary})`)
    return
  }
  log(`Ready (${summary})`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
