import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const packageRoot = path.join(repositoryRoot, 'native', 'projectd-macos')
const product = 'cozea-projectd-mac-helper'
const outputDirectory = path.join(repositoryRoot, 'build', 'projectd-helper')
const requiredArchitectures = ['arm64', 'x86_64']

// One universal helper serves Apple silicon and Intel Macs, and survives the
// universal app merge unchanged because both per-architecture builds carry it.
const buildArguments = [
  'swift',
  'build',
  '--package-path',
  packageRoot,
  '--configuration',
  'release',
  '--product',
  product,
  ...requiredArchitectures.flatMap((architecture) => ['--arch', architecture]),
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf-8',
    stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  return result.stdout?.trim() ?? ''
}

if (process.platform !== 'darwin') {
  console.log('Skipping the projectd macOS helper outside macOS.')
  process.exit(0)
}

run('/usr/bin/xcrun', buildArguments)

// SwiftPM's output folder for multi-architecture builds differs between Xcode releases.
const binaryPath = path.join(run('/usr/bin/xcrun', [...buildArguments, '--show-bin-path'], { capture: true }), product)
const architectures = run('/usr/bin/lipo', ['-archs', binaryPath], { capture: true }).split(/\s+/)
const missing = requiredArchitectures.filter((architecture) => !architectures.includes(architecture))
if (missing.length > 0) {
  console.error(`${binaryPath} lacks ${missing.join(', ')} (has ${architectures.join(', ')}).`)
  process.exit(1)
}

fs.mkdirSync(outputDirectory, { recursive: true })
const outputPath = path.join(outputDirectory, product)
fs.copyFileSync(binaryPath, outputPath)
fs.chmodSync(outputPath, 0o755)
console.log(`Staged ${path.relative(repositoryRoot, outputPath)} (${architectures.join(', ')}).`)
