import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../..')

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8')
}

describe('Cozea local chat runtime wiring', () => {
  it('main process boots shadow server and T3-backed runtime monitor only', () => {
    const mainSource = readRepoFile('apps/desktop/electron/main.ts')

    expect(mainSource).not.toContain('startAssistantRuntime')
    expect(mainSource).not.toContain('assistant-runtime/boot')
    expect(mainSource).toContain('beginShadowHostedRuntimeMonitor')
    expect(mainSource).toContain('ensureSubstrateShadowServerStarted')
  })

  it('registers the assistant runtime status bridge before app readiness flow begins', () => {
    const mainSource = readRepoFile('apps/desktop/electron/main.ts')

    const registerIndex = mainSource.indexOf('registerAssistantRuntimeBridgeHandlers()')
    const whenReadyIndex = mainSource.indexOf('app.whenReady().then(() => {')

    expect(registerIndex).toBeGreaterThan(-1)
    expect(whenReadyIndex).toBeGreaterThan(-1)
    expect(registerIndex).toBeLessThan(whenReadyIndex)
    expect(mainSource).toContain('ipcMain.handle(ASSISTANT_RUNTIME_STATUS_HANDLE')
  })

  it('reports inProcessAssistant false in substrate shadow status', () => {
    const mainSource = readRepoFile('apps/desktop/electron/main.ts')

    expect(mainSource).toContain('inProcessAssistant: false')
    expect(mainSource).not.toContain('shouldStartInProcessAssistantRuntime')
  })
})
