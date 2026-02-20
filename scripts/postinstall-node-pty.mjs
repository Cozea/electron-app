import fs from 'node:fs'
import path from 'node:path'

const targets = ['darwin-arm64', 'darwin-x64']

for (const target of targets) {
  const helperPath = path.join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    target,
    'spawn-helper'
  )

  if (!fs.existsSync(helperPath)) continue

  try {
    fs.chmodSync(helperPath, 0o755)
  } catch {
    // Best-effort permission fix; keep postinstall non-fatal across platforms.
  }
}
