import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot: string = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('scheduled task Computer Use authorization', () => {
  it('derives allow or deny in Electron main from the persisted task', () => {
    const handlers = read('apps/desktop/electron/ipc/registerScheduledTaskHandlers.ts')

    expect(handlers).toContain("control.computerUsePolicy === 'prepare'")
    expect(handlers).toContain('service.list().find((candidate) => candidate.id === report.taskId)')
    expect(handlers).toContain("task.computerUse ? 'allow' : 'deny'")
    expect(handlers).toContain("task.computerUse && deps.loadSettings().computerUseEnabled !== true")
    expect(handlers).toContain('ComputerUseRuntimeService.getInstance().setThreadPolicy')
    expect(handlers).toContain('ComputerUseRuntimeService.getInstance().clearThreadPolicy(threadId)')
  })

  it('enforces an explicit scheduled deny before global Computer Use policy', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    const deny = runtime.indexOf("if (threadPolicy === 'deny')")
    const globalMaster = runtime.indexOf('if (!settings.computerUseEnabled)')

    expect(deny).toBeGreaterThan(-1)
    expect(globalMaster).toBeGreaterThan(deny)
    expect(runtime).toContain('validateActionPolicy(settings, tool, args, this.threadPolicy(sessionId))')
    expect(runtime).toContain('Computer Use is not authorized for this scheduled task.')
  })

  it('prepares authorization before creating or starting the unattended thread', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')
    const prepare = runner.indexOf(
      'await controlScheduledTaskComputerUsePolicy(task.id, threadId, "prepare")',
    )
    const create = runner.indexOf('type: "thread.create"', prepare)
    const start = runner.indexOf('type: "thread.turn.start"', create)

    expect(prepare).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(prepare)
    expect(start).toBeGreaterThan(create)
  })

  it('skips CU-required scheduled work while the master switch is off', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')

    expect(runner).toContain('task.computerUse && snapshot?.computerUseEnabled !== true')
    expect(runner).toContain('error: "Computer Use is disabled in Settings."')
  })

  it('clears scheduled policy on canonical turn settlement and runner teardown', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')

    expect(runner).toContain('latestTurn.turnId === previousTurnId')
    expect(runner).toContain('latestTurn.state !== "completed"')
    expect(runner).toContain('latestTurn.state !== "interrupted"')
    expect(runner).toContain('latestTurn.state !== "error"')
    expect(runner).toContain('for (const [threadId, taskId] of activeComputerUsePolicies)')
  })

  it('keeps scheduled policy lifecycle-bound and fail-closed across live runtime resets', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    const resetAllStart = runtime.indexOf('async resetAll(): Promise<void>')
    const startBroker = runtime.indexOf('async startBroker(): Promise<ComputerUseRuntimeEnvironment>')
    const resetAllBody = runtime.slice(resetAllStart, startBroker)

    expect(runtime).toContain(
      'private readonly threadPolicies = new Map<string, ExplicitComputerUseThreadPolicy>()',
    )
    expect(runtime).not.toContain('THREAD_POLICY_TTL_MS')
    expect(runtime).not.toContain('expiresAt')
    expect(runtime).not.toContain('pruneExpiredThreadPolicies')
    expect(resetAllBody).not.toContain('this.threadPolicies.clear()')
    expect(runtime).toContain('finally {\n      this.clearThreadPolicy(sessionId)')
    expect(runtime).toContain('this.threadPolicies.clear()')
  })
})
