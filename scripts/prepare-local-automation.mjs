import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const packageRoot = path.join(repositoryRoot, 'native', 'local-automation-helper')
const configuration = process.argv.includes('--debug') ? 'debug' : 'release'
const buildDirectory = path.join(packageRoot, '.build', configuration)
const modelPath = path.join(packageRoot, 'Models', 'DevCommandRanker.mlmodel')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.log('Skipping Core ML local automation helper outside Apple silicon macOS.')
  process.exit(0)
}

for (const product of ['generate-dev-command-ranker', 'cozea-local-automation-helper']) {
  run('/usr/bin/xcrun', [
    'swift',
    'build',
    '--package-path',
    packageRoot,
    '--configuration',
    configuration,
    '--product',
    product,
  ])
}

run(path.join(buildDirectory, 'generate-dev-command-ranker'), ['--output', modelPath])

if (configuration === 'release') {
  const outputDirectory = path.join(repositoryRoot, 'build', 'local-automation')
  fs.mkdirSync(outputDirectory, { recursive: true })
  fs.copyFileSync(
    path.join(buildDirectory, 'cozea-local-automation-helper'),
    path.join(outputDirectory, 'cozea-local-automation-helper'),
  )
  fs.copyFileSync(modelPath, path.join(outputDirectory, 'DevCommandRanker.mlmodel'))
}
