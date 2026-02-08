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

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: options.env ?? env,
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      resolve({ ok: (code ?? 1) === 0, code: code ?? 1 })
    })

    child.on('error', (error) => {
      console.error(
        `[dev:bundled-git] ${command} failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      resolve({ ok: false, code: 1 })
    })
  })
}

async function main() {
  const check = await run(process.execPath, [path.join(rootDir, 'scripts/prepare-bundled-git.mjs'), '--check'])
  if (!check.ok) {
    console.error(
      '[dev:bundled-git] Bundled Git check failed. Run `npm run prepare:bundled-git` first (or provide COZEA_GIT_BUNDLE_URL_* for missing targets).'
    )
    process.exit(check.code)
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const dev = await run(npmCommand, ['run', 'dev'])
  process.exit(dev.code)
}

void main()
