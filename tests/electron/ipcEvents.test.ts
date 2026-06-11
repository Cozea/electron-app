import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSourceFiles } from '../helpers/scan'
import { extractStringArgCalls, extractStringPropertyAssignments } from '../helpers/tsAst'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

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

    // Channels routed through batching/broadcast helpers take the channel name as
    // a `channel:` option or a *_CHANNEL const instead of a direct send() argument.
    const emittedByChannelOption = collectAllStrings(
      electronFiles.map((filePath) =>
        extractStringPropertyAssignments({
          filePath,
          propertyNames: ['channel'],
        })
      )
    )

    const emitted = new Set<string>([...emittedBySend, ...emittedByHelper, ...emittedByChannelOption])

    // No allowlisted gaps: every preload listener must have an emitter.
    const allowlist = new Set<string>([])

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
