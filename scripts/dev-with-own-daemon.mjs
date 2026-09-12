import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the dev app with its own profile and its own cozea-projectd, so it can sit
 * beside an installed Cozea on the same Mac, for example as the second Mac in a live
 * session test.
 *
 * Every copy of Cozea shares one profile folder (named after `@cozea/desktop`) and one
 * daemon socket and state folder. A second copy on the same profile quits at once,
 * because the first holds its single-instance lock. This gives the dev app its own
 * profile, and so its own device identity, and gives its daemon its own socket and
 * state; the dev launcher passes these variables to the daemon it starts.
 *
 * Usage: bun run dev:own-daemon [name]   (name defaults to "dev")
 */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2] ?? 'dev'
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error('The name may use lowercase letters, digits and hyphens only.')
  process.exit(1)
}

const uid = typeof process.getuid === 'function' ? process.getuid() : 501
const stateRoot = path.join(os.homedir(), 'Library', 'Application Support', `Cozea-${name}`)
fs.mkdirSync(stateRoot, { recursive: true })

const env = {
  ...process.env,
  COZEA_USER_DATA_DIR: path.join(stateRoot, 'profile'),
  // Unix socket paths are limited to 104 bytes on macOS, so this stays under /tmp
  // like the default socket.
  COZEA_PROJECTD_SOCKET: `/tmp/cozea-projectd-${uid}-${name}.sock`,
  COZEA_PROJECTD_DB: path.join(stateRoot, 'projectd.sqlite'),
  COZEA_WORKSPACE_CATALOG_PATH: path.join(stateRoot, 'workspace-catalog.json'),
  COZEA_GIT_MIRRORS_DIR: path.join(stateRoot, 'git-mirrors'),
  COZEA_BINARY_CACHE_DIR: path.join(stateRoot, 'binary-cache'),
  COZEA_COLLAB_REPOS_DIR: path.join(stateRoot, 'collaboration'),
}

const stagedHelper = path.join(repositoryRoot, 'build', 'projectd-helper', 'cozea-projectd-mac-helper')
if (fs.existsSync(stagedHelper)) env.COZEA_MAC_HELPER_PATH = stagedHelper

console.log(`Dev app with its own daemon on ${env.COZEA_PROJECTD_SOCKET}, state in ${stateRoot}.`)
console.log(`The daemon keeps running after the app quits. Stop it with:`)
console.log(`  bun run projectctl shutdown --socket ${env.COZEA_PROJECTD_SOCKET}`)

const child = spawn('bun', ['run', 'dev'], { cwd: repositoryRoot, env, stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
