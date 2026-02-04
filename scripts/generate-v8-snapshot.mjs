import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = path.join(rootDir, 'electron', 'snapshot-entry.js')
const outputDir = path.join(rootDir, 'build', 'v8-snapshot')
const buildDir = path.join(rootDir, 'build')

if (!existsSync(entryPath)) {
  throw new Error(`Snapshot entry not found: ${entryPath}`)
}

const binCandidates = (() => {
  if (process.platform === 'win32') {
    return [
      path.join(rootDir, 'node_modules', '.bin', 'mksnapshot.cmd'),
      path.join(rootDir, 'node_modules', '.bin', 'mksnapshot.js.cmd'),
    ]
  }
  return [
    path.join(rootDir, 'node_modules', '.bin', 'mksnapshot'),
    path.join(rootDir, 'node_modules', '.bin', 'mksnapshot.js'),
  ]
})()

const binPath = binCandidates.find((candidate) => existsSync(candidate))
if (!binPath) {
  throw new Error('mksnapshot binary not found. Ensure electron-mksnapshot is installed.')
}

await mkdir(outputDir, { recursive: true })
await mkdir(buildDir, { recursive: true })

await new Promise((resolve, reject) => {
  const child = spawn(binPath, [entryPath, '--output_dir', outputDir], { stdio: 'inherit' })
  child.on('close', (code) => {
    if (code === 0) {
      resolve(undefined)
      return
    }
    reject(new Error(`mksnapshot exited with code ${code}`))
  })
  child.on('error', reject)
})

const snapshotBlobPath = path.join(outputDir, 'snapshot_blob.bin')
const v8ContextPath = path.join(outputDir, 'v8_context_snapshot.bin')
const browserSnapshotPath = path.join(outputDir, 'browser_v8_context_snapshot.bin')

if (!existsSync(snapshotBlobPath) || !existsSync(v8ContextPath)) {
  throw new Error('Snapshot output missing. Check mksnapshot logs for details.')
}

await copyFile(v8ContextPath, browserSnapshotPath)
await copyFile(snapshotBlobPath, path.join(buildDir, 'snapshot_blob.bin'))
await copyFile(browserSnapshotPath, path.join(buildDir, 'browser_v8_context_snapshot.bin'))

console.log('[Snapshot] Generated V8 snapshot artifacts in build/v8-snapshot')
