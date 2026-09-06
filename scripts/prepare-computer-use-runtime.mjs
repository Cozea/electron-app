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

function fail(message) {
  throw new Error(`[prepare-computer-use-runtime] ${message}`)
}

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

function runtimeArch() {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'x64') return 'amd64'
  fail(`Unsupported Computer Use architecture: ${process.arch}`)
}

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

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(outputRoot, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

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

function prepareMac() {
  const script = debug ? 'build:debug' : 'build'
  run('bun', ['run', '--cwd', nativePackageRoot, script])

  const napiArch = process.arch === 'arm64' ? 'arm64' : 'x64'
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
  const dylib = dylibs[0]
  if (!dylib) fail('Swift bridge dylib was not produced.')

  fs.copyFileSync(addon, path.join(outputRoot, addonName))
  fs.copyFileSync(dylib, path.join(outputRoot, 'libCozeaComputerUseBridge.dylib'))
}

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
