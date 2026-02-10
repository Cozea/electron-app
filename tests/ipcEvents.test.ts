import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSourceFiles } from './helpers/scan'
import { extractStringArgCalls } from './helpers/tsAst'

const REPO_ROOT = path.resolve(__dirname, '..')

function collectAllStrings(sets: Array<Set<string>>): Set<string> {
  const out = new Set<string>()
  for (const set of sets) {
    for (const value of set) out.add(value)
  }
  return out
}

describe('IPC Event Coverage', () => {
  it('every ipcRenderer.on event in preload is emitted via webContents.send somewhere in electron/', () => {
    const preloadPath = path.join(REPO_ROOT, 'electron', 'preload.ts')
    const subscribed = extractStringArgCalls({
      filePath: preloadPath,
      rootObjectNames: ['ipcRenderer'],
      methodNames: ['on'],
    })

    const electronRoot = path.join(REPO_ROOT, 'electron')
    const electronFiles = collectSourceFiles({ rootDir: electronRoot, extensions: ['.ts'] })

    const emittedBySend = collectAllStrings(
      electronFiles.map((filePath) =>
        extractStringArgCalls({
          filePath,
          methodNames: ['send'],
        })
      )
    )

    const emittedByHelper = collectAllStrings(
      electronFiles.map((filePath) =>
        extractStringArgCalls({
          filePath,
          methodNames: [],
          calleeNames: ['sendToRenderers'],
        })
      )
    )

    const emitted = new Set<string>([...emittedBySend, ...emittedByHelper])

    const allowlist = new Set<string>([
      // These are currently part of the preload API surface but not emitted anywhere
      // (i.e. the callback would never fire). We allowlist them so we don't block
      // refactors on known gaps; if/when implemented, remove from allowlist.
      'devServer:error',
      'window:fullscreen-change',
    ])

    const missing = Array.from(subscribed)
      .filter((eventName) => !allowlist.has(eventName))
      .filter((eventName) => !emitted.has(eventName))
      .sort()

    expect(
      missing,
      `Missing event emitters (webContents.send / sender.send) for ipcRenderer.on: ${missing.join(', ')}`
    ).toEqual([])
  })
})
