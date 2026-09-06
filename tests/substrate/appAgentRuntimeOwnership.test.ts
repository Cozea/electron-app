import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { shouldStartScheduledTaskRunner } from '../../apps/desktop/src/substrate/appAgentRuntimePolicy'

const repositoryRoot = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('app-level agent runtime ownership', () => {
  it('requires the full T3 cutover before scheduling in primary mode', () => {
    const base = {
      enableScheduledTasks: true,
      rpcChatEnabled: true,
      transportLoading: false,
      hasShadowStatus: true,
      primaryExpected: true,
      substrateActive: true,
    }

    expect(shouldStartScheduledTaskRunner({ ...base, cutoverActive: false })).toBe(false)
    expect(shouldStartScheduledTaskRunner({ ...base, cutoverActive: true })).toBe(true)
  })

  it('never starts the scheduler before RPC shadow discovery or in a disabled renderer', () => {
    expect(
      shouldStartScheduledTaskRunner({
        enableScheduledTasks: true,
        rpcChatEnabled: true,
        transportLoading: true,
        hasShadowStatus: false,
        primaryExpected: false,
        substrateActive: false,
        cutoverActive: false,
      }),
    ).toBe(false)

    expect(
      shouldStartScheduledTaskRunner({
        enableScheduledTasks: false,
        rpcChatEnabled: true,
        transportLoading: false,
        hasShadowStatus: true,
        primaryExpected: true,
        substrateActive: true,
        cutoverActive: true,
      }),
    ).toBe(false)
  })

  it('preserves the legacy runtime path when substrate RPC is not enabled', () => {
    expect(
      shouldStartScheduledTaskRunner({
        enableScheduledTasks: true,
        rpcChatEnabled: false,
        transportLoading: false,
        hasShadowStatus: false,
        primaryExpected: false,
        substrateActive: false,
        cutoverActive: false,
      }),
    ).toBe(true)
  })

  it('keeps full cutover ownership in the app host instead of foreground consumers', () => {
    const app = read('apps/desktop/src/App.tsx')
    const host = read('apps/desktop/src/substrate/AppAgentRuntimeHost.tsx')
    const workbenchConfig = read(
      'apps/desktop/src/features/workbench/assistant/useAssistantServerConfig.ts',
    )
    const schedulesConfig = read('apps/desktop/src/substrate/useT3ServerConfigCutover.ts')

    expect(app).toContain('<AppAgentRuntimeHost enableScheduledTasks={!isSettingsWindow} />')
    expect(app).not.toContain("import('@/features/projects/model/scheduledTaskRunner')")
    expect(host.match(/useT3Cutover\(/g)).toHaveLength(1)
    expect(host).toContain('module.startScheduledTaskRunner({ getNativeApi })')
    expect(workbenchConfig).not.toContain('useT3Cutover')
    expect(workbenchConfig).not.toContain('useSubstrateChatTransport')
    expect(schedulesConfig).not.toContain('fetchT3RpcSession')
    expect(schedulesConfig).not.toContain('T3ServerConfigClient')
    expect(schedulesConfig).toContain('Full T3/config lifecycle')
  })

  it('does not leak app-owned substrate loading into an inactive compatibility surface', () => {
    const schedulesConfig = read('apps/desktop/src/substrate/useT3ServerConfigCutover.ts')

    expect(schedulesConfig).toContain(
      'loading: input.substrateActive ? !active || metadata.isConfigLoading : false',
    )
  })
})
