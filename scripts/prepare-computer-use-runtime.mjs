#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const outputRoot = path.join(repositoryRoot, 'build', 'computer-use-runtime')
const nativePackageRoot = path.join(repositoryRoot, 'packages', 'computer-use-native')
const swiftPackageRoot = path.join(repositoryRoot, 'native', 'computer-use-bridge')
const upstreamPackageRoot = path.join(repositoryRoot, 'node_modules', 'open-computer-use')
const licenseSource = path.join(swiftPackageRoot, 'OPEN_COMPUTER_USE_LICENSE.txt')
const LICENSE_ARTIFACT = 'OPEN_COMPUTER_USE_LICENSE.txt'
const UPSTREAM_VERSION = '0.3.3'
const UPSTREAM_REVISION = '41c5294cfe4735baca03f9c82b4de99d191a0b49'
const checkOnly = process.argv.includes('--check')
const debug = process.argv.includes('--debug')

/**
 * Throws an error with a prefixed message for this script.
 *
 * @param {string} message - Error message
 * @throws {Error} Always throws
 */
function fail(message) {
  throw new Error(`[prepare-computer-use-runtime] ${message}`)
}

/**
 * Runs a command synchronously and returns its stdout, failing with a descriptive error on non-zero exit.
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Options object
 * @param {string} [options.cwd] - Working directory
 * @param {boolean} [options.capture] - Whether to capture and return stdout
 * @returns {string} Command stdout if capture is true, empty string otherwise
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = options.capture ? `\n${(result.stderr || result.stdout || '').trim()}` : ''
    fail(`${command} ${args.join(' ')} exited with status ${result.status}.${detail}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

/**
 * Recursively walks a directory tree, returning all files matching a predicate.
 *
 * @param {string} root - Root directory to walk
 * @param {(path: string, name: string) => boolean} predicate - Predicate to test each file
 * @returns {string[]} Array of matching file paths
 */
function walkFor(root, predicate) {
  if (!fs.existsSync(root)) return []
  const matches = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (predicate(entryPath, entry.name)) matches.push(entryPath)
    }
  }
  visit(root)
  return matches
}

/**
 * Maps Node.js process.arch to the architecture string expected by the upstream runtime.
 *
 * @returns {string} Runtime architecture ('arm64' or 'amd64')
 */
function runtimeArch() {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'x64') return 'amd64'
  fail(`Unsupported Computer Use architecture: ${process.arch}`)
}

/**
 * Returns the expected artifact filenames for the current platform and architecture.
 *
 * @returns {string[]} Array of expected artifact filenames
 */
function expectedArtifactNames() {
  const common = [LICENSE_ARTIFACT]
  if (process.platform === 'darwin') {
    const napiArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return [
      ...common,
      `cozea_computer_use.darwin-${napiArch}.node`,
      'libCozeaComputerUseBridge.dylib',
    ]
  }
  if (process.platform === 'win32') return [...common, 'open-computer-use.exe']
  if (process.platform === 'linux') return [...common, 'open-computer-use']
  return common
}

/**
 * Reads the build manifest if it exists, returning null if missing or invalid.
 *
 * @returns {Object|null} Parsed manifest object or null
 */
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(outputRoot, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Checks if the current output directory is up-to-date for the current platform and upstream version.
 *
 * @returns {boolean} True if output is current, false otherwise
 */
function outputIsCurrent() {
  const manifest = readManifest()
  if (!manifest) return false
  if (
    manifest.schemaVersion !== 1 ||
    manifest.upstreamVersion !== UPSTREAM_VERSION ||
    manifest.upstreamRevision !== UPSTREAM_REVISION ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch
  ) return false
  return expectedArtifactNames().every((name) => fs.existsSync(path.join(outputRoot, name)))
}

/**
 * Verifies that the expected open-computer-use npm package is installed with the correct version.
 *
 * @throws {Error} If the package is missing or version doesn't match
 */
function verifyUpstreamNpmPackage() {
  const packageJsonPath = path.join(upstreamPackageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    fail('node_modules/open-computer-use is missing; run bun install first.')
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  if (packageJson.version !== UPSTREAM_VERSION) {
    fail(`Expected open-computer-use ${UPSTREAM_VERSION}, found ${packageJson.version || 'unknown'}.`)
  }
}

/**
 * Checks if a dylib file matches the current process architecture using lipo.
 *
 * @param {string} candidate - Path to the dylib to check
 * @returns {boolean} True if the dylib contains the current architecture
 */
function dylibMatchesCurrentArchitecture(candidate) {
  const expected = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const archs = run('/usr/bin/xcrun', ['lipo', '-archs', candidate], { capture: true })
    .split(/\s+/)
    .filter(Boolean)
  return archs.includes(expected)
}

/**
 * Prepares macOS Computer Use runtime by building the native addon and Swift bridge dylib,
 * then copying them to the output directory.
 */
function prepareMac() {
  const napiArch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const script = debug ? `build:debug:${napiArch}` : `build:${napiArch}`
  run('bun', ['run', '--cwd', nativePackageRoot, script])

  const addonName = `cozea_computer_use.darwin-${napiArch}.node`
  const addonCandidates = [
    path.join(nativePackageRoot, addonName),
    ...walkFor(nativePackageRoot, (_file, name) => name === addonName),
  ].filter((candidate, index, values) => fs.existsSync(candidate) && values.indexOf(candidate) === index)
  const addon = addonCandidates[0]
  if (!addon) fail(`Native addon ${addonName} was not produced.`)

  const dylibs = walkFor(
    path.join(swiftPackageRoot, '.build'),
    (_file, name) => name === 'libCozeaComputerUseBridge.dylib',
  ).sort((a, b) => Number(b.includes('/release/')) - Number(a.includes('/release/')))
  const dylib = dylibs.find(dylibMatchesCurrentArchitecture)
  if (!dylib) {
    fail(`Swift bridge dylib for ${process.arch} was not produced.`)
  }

  fs.copyFileSync(addon, path.join(outputRoot, addonName))
  fs.copyFileSync(dylib, path.join(outputRoot, 'libCozeaComputerUseBridge.dylib'))
}

/**
 * Prepares Windows/Linux Computer Use runtime by copying the upstream worker binary from node_modules.
 *
 * @param {string} platform - Platform name ('windows' or 'linux')
 */
function prepareWorker(platform) {
  verifyUpstreamNpmPackage()
  const arch = runtimeArch()
  const fileName = platform === 'windows' ? 'open-computer-use.exe' : 'open-computer-use'
  const source = path.join(upstreamPackageRoot, 'dist', platform, arch, fileName)
  if (!fs.existsSync(source)) {
    fail(`Bundled upstream runtime is missing: ${source}`)
  }
  const destination = path.join(outputRoot, fileName)
  fs.copyFileSync(source, destination)
  if (platform !== 'windows') fs.chmodSync(destination, 0o755)
}

if (checkOnly) {
  if (!outputIsCurrent()) fail('Prepared Computer Use runtime is missing or stale.')
  process.exit(0)
}

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })

if (process.platform === 'darwin') {
  prepareMac()
} else if (process.platform === 'win32') {
  prepareWorker('windows')
} else if (process.platform === 'linux') {
  prepareWorker('linux')
} else {
  fail(`Unsupported platform: ${process.platform}`)
}

if (!fs.existsSync(licenseSource)) fail(`Missing required upstream license: ${licenseSource}`)
fs.copyFileSync(licenseSource, path.join(outputRoot, LICENSE_ARTIFACT))

fs.writeFileSync(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    upstream: 'iFurySt/open-codex-computer-use',
    upstreamVersion: UPSTREAM_VERSION,
    upstreamRevision: UPSTREAM_REVISION,
    platform: process.platform,
    arch: process.arch,
    backend: process.platform === 'darwin' ? 'OpenComputerUseKit-in-process' : 'upstream-mcp-worker',
    license: LICENSE_ARTIFACT,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`,
  'utf8',
)

console.log(`[prepare-computer-use-runtime] Prepared ${process.platform}/${process.arch} from open-computer-use ${UPSTREAM_VERSION}.`)
