import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSourceFiles } from '../helpers/scan'
import { extractStringArgCalls } from '../helpers/tsAst'

const REPO_ROOT = path.resolve(__dirname, '..')

function collectAllStrings(sets: Array<Set<string>>): Set<string> {
  const out = new Set<string>()
  for (const set of sets) {
    for (const value of set) out.add(value)
  }
  return out
}

describe('IPC Invoke Coverage', () => {
  it('every ipcRenderer.invoke channel in preload has a corresponding ipcMain.handle', () => {
    const preloadPath = path.join(REPO_ROOT, 'electron', 'preload.ts')
    const invoked = extractStringArgCalls({
      filePath: preloadPath,
      rootObjectNames: ['ipcRenderer'],
      methodNames: ['invoke'],
    })

    const electronRoot = path.join(REPO_ROOT, 'electron')
    const electronFiles = collectSourceFiles({ rootDir: electronRoot, extensions: ['.ts'] })
    const handled = collectAllStrings(
      electronFiles.map((filePath) =>
        extractStringArgCalls({
          filePath,
          rootObjectNames: ['ipcMain'],
          methodNames: ['handle'],
        })
      )
    )

    const missing = Array.from(invoked).filter((channel) => !handled.has(channel)).sort()
    expect(
      missing,
      `Missing ipcMain.handle channels for ipcRenderer.invoke: ${missing.join(', ')}`
    ).toEqual([])
  })
})

