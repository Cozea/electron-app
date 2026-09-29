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
function buildHelper() {
  const perArchBinaries = requiredArchitectures.map((arch) => {
    run('/usr/bin/xcrun', [
      'swift',
      'build',
      '--package-path',
      packageRoot,
      '--configuration',
      'release',
      '--product',
      product,
      '--arch',
      arch,
    ])
    return path.join(packageRoot, '.build', `${arch}-apple-macosx`, 'release', product)
  })

  fs.mkdirSync(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, product)
  run('/usr/bin/lipo', ['-create', '-output', outputPath, ...perArchBinaries])
  return outputPath
}

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

const outputPath = buildHelper()
const architectures = run('/usr/bin/lipo', ['-archs', outputPath], { capture: true }).split(/\s+/)
const missing = requiredArchitectures.filter((architecture) => !architectures.includes(architecture))
if (missing.length > 0) {
  console.error(`${outputPath} lacks ${missing.join(', ')} (has ${architectures.join(', ')}).`)
  process.exit(1)
}

fs.chmodSync(outputPath, 0o755)

// Strip quarantine/provenance attributes and re-sign ad-hoc so macOS AMFI
// validates the staged universal binary without SIGKILL (Code Signature Invalid).
run('/usr/bin/xattr', ['-cr', outputPath])
run('/usr/bin/codesign', ['-f', '-s', '-', outputPath])

console.log(`Staged ${path.relative(repositoryRoot, outputPath)} (${architectures.join(', ')}).`)

