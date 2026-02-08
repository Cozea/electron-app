import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundledGitRoot = path.join(rootDir, 'build', 'git')

const env = {
  ...process.env,
  COZEA_FORCE_BUNDLED_GIT: '1',
  COZEA_BUNDLED_GIT_ROOT: bundledGitRoot,
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(npmCommand, ['run', 'dev'], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(`[dev:bundled-git] Failed to start dev server: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
