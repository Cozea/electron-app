import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ComputerUseRuntimeService,
  __computerUseRuntimeTesting,
} from '../../apps/desktop/electron/services/ComputerUseRuntimeService'

const repositoryRoot: string = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

const enabledSettings = {
  projectsDirectory: '/tmp',
  previewHeaderCompatibilityEnabled: false,
  computerUseEnabled: true,
  disabledComputerUseTools: [],
  computerUseAllowGlobalPointerFallbacks: false,
} as any

describe('scheduled task Computer Use authorization', () => {
  it('enforces an explicit scheduled deny before otherwise-valid global policy', () => {
    expect(
      __computerUseRuntimeTesting.validateActionPolicy(
        enabledSettings,
        'list_apps',
        {},
        'deny',
      ),
    ).toBe('Computer Use is not authorized for this scheduled task.')
    expect(
      __computerUseRuntimeTesting.validateActionPolicy(
        enabledSettings,
        'list_apps',
        {},
        'allow',
      ),
    ).toBeNull()
  })

  it('normalizes thread IDs and binds one active policy to each scheduled task', () => {
    const runtime = new ComputerUseRuntimeService()

    runtime.setScheduledThreadPolicy('task-1', '  thread-1  ', 'deny')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-1')).toBe('deny')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, '  thread-1  ')).toBe('deny')

    // A later launch for the same scheduled task replaces an orphaned pre-start
    // lease instead of allowing renderer code to clear arbitrary thread policy.
    runtime.setScheduledThreadPolicy('task-1', 'thread-2', 'allow')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-1')).toBe('inherit')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-2')).toBe('allow')

    runtime.revokeScheduledTaskPolicy('task-1')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-2')).toBe('deny')

    runtime.clearScheduledTaskPolicy('task-1')
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-2')).toBe('inherit')
  })

  it('derives allow or deny in Electron main and exposes no renderer clear action', () => {
    const handlers = read('apps/desktop/electron/ipc/registerScheduledTaskHandlers.ts')

    expect(handlers).toContain("control.computerUsePolicy === 'prepare'")
    expect(handlers).toContain('service.list().find((candidate) => candidate.id === report.taskId)')
    expect(handlers).toContain("task.computerUse ? 'allow' : 'deny'")
    expect(handlers).toContain("task.computerUse && deps.loadSettings().computerUseEnabled !== true")
    expect(handlers).toContain('setScheduledThreadPolicy(')
    expect(handlers).not.toContain("computerUsePolicy === 'clear'")
    expect(handlers).not.toContain('clearThreadPolicy(threadId)')
  })

  it('prepares authorization before creating or starting the unattended thread', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')
    const prepare = runner.indexOf('await prepareScheduledTaskComputerUsePolicy(task.id, threadId)')
    const create = runner.indexOf('type: "thread.create"', prepare)
    const start = runner.indexOf('type: "thread.turn.start"', create)

    expect(prepare).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(prepare)
    expect(start).toBeGreaterThan(create)
    expect(runner).not.toContain('computerUsePolicy: "clear"')
    expect(runner).not.toContain("computerUsePolicy: 'clear'")
  })

  it('skips CU-required scheduled work while the master switch is off', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')

    expect(runner).toContain('task.computerUse && snapshot?.computerUseEnabled !== true')
    expect(runner).toContain('error: "Computer Use is disabled in Settings."')
  })

  it('uses T3 accepted terminal lifecycle as the only active-run release path', () => {
    const t3 = read('vendor/t3code/apps/server/src/mcp/toolkits/computerUse.ts')
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')

    expect(t3).toContain('isComputerUseTurnTerminalSession(session)')
    expect(t3).toContain('return notifyComputerUseTurnEnded(String(threadId))')
    expect(t3).not.toContain('ACTIVE_COMPUTER_USE_THREADS')
    expect(runtime).toContain('const hadActiveRuntime = this.activeRuntimeSessions.delete(normalizedSessionId)')
    expect(runtime).toContain('this.clearThreadPolicy(normalizedSessionId)')
    expect(runtime).toContain('if (!hadActiveRuntime) return')
  })

  it('keeps scheduled policy fail-closed across live runtime resets', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    const resetAllStart = runtime.indexOf('async resetAll(): Promise<void>')
    const startBroker = runtime.indexOf('async startBroker(): Promise<ComputerUseRuntimeEnvironment>')

    expect(resetAllStart).toBeGreaterThan(-1)
    expect(startBroker).toBeGreaterThan(resetAllStart)
    const resetAllBody = runtime.slice(resetAllStart, startBroker)

    expect(runtime).not.toContain('THREAD_POLICY_TTL_MS')
    expect(runtime).not.toContain('expiresAt')
    expect(resetAllBody).not.toContain('this.threadPolicies.clear()')
    expect(resetAllBody).toContain("if (entry.policy === 'allow') entry.policy = 'deny'")
    expect(runtime).toContain('this.threadPolicies.clear()')
    expect(runtime).toContain('this.scheduledThreadByTask.clear()')
  })
})
