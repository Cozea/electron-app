#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'build/computer-use-runtime')
const bridge = path.join(root, 'native/computer-use-bridge')
const native = path.join(root, 'packages/computer-use-native')
const configuration = process.argv.includes('--debug') ? 'debug' : 'release'
const checkOnly = process.argv.includes('--check')
const supported = process.platform === 'darwin'
const licenseName = 'OPEN_COMPUTER_USE_LICENSE.txt'
const fail = (message) => { throw new Error(`[prepare-computer-use-runtime] ${message}`) }
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error || result.status !== 0) fail(`${command} failed: ${result.error?.message ?? (capture ? result.stderr : result.status)}`)
  return capture ? result.stdout.trim() : ''
}
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function sourcesDigest() {
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.build', 'target', 'node_modules'].includes(entry.name) || entry.name.endsWith('.node')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(swift|rs|toml|json|lock|txt|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ['native/computer-use-runtime', 'native/computer-use-bridge', 'packages/computer-use-native']) walk(path.join(root, dir))
  files.push(fileURLToPath(import.meta.url))
  const digest = createHash('sha256')
  for (const file of files.sort()) digest.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0')
  return digest.digest('hex')
}
const sourceDigest = sourcesDigest()
if (supported && !['arm64', 'x64'].includes(process.arch)) fail(`Unsupported macOS architecture ${process.arch}`)
const addonName = `cozea_computer_use.darwin-${process.arch}.node`
const artifactNames = supported ? [addonName, 'libCozeaComputerUseBridge.dylib', licenseName, 'CozeaComputerUseRuntime_CozeaComputerUseCore.bundle'] : [licenseName]
function treeDigest(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  const value = entries.map((entry) => `${entry.name}:${entry.isDirectory() ? treeDigest(path.join(directory, entry.name)) : hash(path.join(directory, entry.name))}`).join('\n')
  return createHash('sha256').update(value).digest('hex')
}
function artifactHash(file) { return fs.statSync(file).isDirectory() ? treeDigest(file) : hash(file) }
if (checkOnly) {
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 2 || manifest.abiVersion !== 2 || manifest.sourceDigest !== sourceDigest ||
      manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.configuration !== configuration || manifest.supported !== supported) fail('Prepared runtime is stale. Rebuild it.')
  for (const name of artifactNames) {
    const file = path.join(output, name)
    if (!fs.existsSync(file) || manifest.artifacts[name] !== artifactHash(file)) fail(`Missing or modified artifact: ${name}`)
  }
  process.exit(0)
}
const staging = `${output}.staging-${randomUUID()}`
fs.mkdirSync(staging, { recursive: true })
try {
  if (supported) {
    const script = configuration === 'debug' ? `build:debug:${process.arch}` : `build:${process.arch}`
    run('bun', ['run', '--cwd', native, script])
    const triple = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`
    const bin = run('/usr/bin/xcrun', ['swift', 'build', '--package-path', bridge, '--configuration', configuration, '--triple', triple, '--show-bin-path'], true)
    const addon = path.join(native, addonName)
    const dylib = path.join(bin, 'libCozeaComputerUseBridge.dylib')
    for (const file of [addon, dylib]) {
      if (!fs.existsSync(file)) fail(`Build did not produce ${file}`)
      const archs = run('/usr/bin/xcrun', ['lipo', '-archs', file], true).split(/\s+/)
      if (!archs.includes(process.arch === 'arm64' ? 'arm64' : 'x86_64')) fail(`Wrong binary architecture: ${file}`)
      fs.copyFileSync(file, path.join(staging, path.basename(file)))
    }
    const resourceName = 'CozeaComputerUseRuntime_CozeaComputerUseCore.bundle'
    const resource = path.join(bin, resourceName)
    if (!fs.existsSync(resource)) fail('SwiftPM tool-catalogue resource bundle was not produced.')
    fs.cpSync(resource, path.join(staging, resourceName), { recursive: true })
  }
  fs.copyFileSync(path.join(root, 'native/computer-use-runtime/LICENSE.upstream.txt'), path.join(staging, licenseName))
  const artifacts = Object.fromEntries(artifactNames.map((name) => [name, artifactHash(path.join(staging, name))]))
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ schemaVersion: 2, abiVersion: 2, version: '2.0.0',
    backend: 'CozeaMacComputerRuntimeV2', supported, platform: process.platform, arch: process.arch, configuration,
    sourceDigest, artifacts, generatedAt: new Date().toISOString() }, null, 2) + '\n')
  fs.rmSync(output, { recursive: true, force: true })
  fs.renameSync(staging, output)
} finally { fs.rmSync(staging, { recursive: true, force: true }) }
console.log(`[prepare-computer-use-runtime] ${supported ? 'Prepared native ABI 2' : 'Computer Use unsupported'} on ${process.platform}/${process.arch}.`)
