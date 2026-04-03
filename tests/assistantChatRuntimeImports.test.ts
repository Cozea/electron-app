import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8')
}

describe('Cozea local chat runtime wiring', () => {
  it('desktop boot provides the startup service layer required by the runtime program', () => {
    const bootSource = readRepoFile('electron/assistant-runtime/boot.ts')

    expect(bootSource).toContain('Layer.provideMerge(CliConfig.layer)')
    expect(bootSource).toContain('makeServerRuntimeProgram(input)')
    expect(bootSource).toContain('Effect.provide(RuntimeLayer)')
  })

  it('uses the installed Effect reactivity entrypoint that exists in this repo version', () => {
    const sqliteClientSource = readRepoFile('electron/assistant-runtime/persistence/NodeSqliteClient.ts')

    expect(sqliteClientSource).toContain('effect/unstable/reactivity/Reactivity')
    expect(sqliteClientSource).not.toContain('effect/Reactivity')
  })

  it('registers the assistant runtime status bridge before app readiness flow begins', () => {
    const mainSource = readRepoFile('electron/main.ts')

    const registerIndex = mainSource.indexOf('registerAssistantRuntimeBridgeHandlers()')
    const whenReadyIndex = mainSource.indexOf('app.whenReady().then(() => {')

    expect(registerIndex).toBeGreaterThan(-1)
    expect(whenReadyIndex).toBeGreaterThan(-1)
    expect(registerIndex).toBeLessThan(whenReadyIndex)
    expect(mainSource).toContain('ipcMain.handle(ASSISTANT_RUNTIME_STATUS_HANDLE')
  })

  it('drops the cached runtime fiber only when the exiting fiber is still the active one', () => {
    const mainSource = readRepoFile('electron/main.ts')

    expect(mainSource).toContain('if (assistantRuntimeFiber === fiber)')
    expect(mainSource).toContain('assistantRuntimeFiber = null')
    expect(mainSource).toContain('scheduleAssistantRuntimeRestart()')
  })
})
