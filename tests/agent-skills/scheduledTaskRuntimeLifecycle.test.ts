import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  isScheduledTaskRuntimeUnavailableError,
  ScheduledTaskRuntimeUnavailableError,
} from '../../apps/desktop/src/features/projects/model/scheduledTaskRuntime'

const repositoryRoot = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('scheduled task runtime lifecycle', () => {
  it('classifies only the explicit pre-dispatch runtime condition as retryable', () => {
    expect(
      isScheduledTaskRuntimeUnavailableError(new ScheduledTaskRuntimeUnavailableError()),
    ).toBe(true)
    expect(isScheduledTaskRuntimeUnavailableError(new Error('thread.turn.start failed'))).toBe(false)
  })

  it('uses a non-blocking NativeApi lookup rather than the deferred 10 second proxy', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')
    const nativeApi = read('apps/desktop/src/lib/nativeApi.ts')

    expect(runner).not.toContain('ensureNativeApi')
    expect(runner).toContain('getNativeApi?: () => NativeApi | undefined')
    expect(runner).toContain('nativeApi: NativeApi | undefined = readAvailableNativeApi()')
    expect(nativeApi).toContain('export function readT3NativeApiOverlay()')
    expect(nativeApi).toContain('export function readAvailableNativeApi()')
  })

  it('leaves a task due when runtime readiness fails before orchestration dispatch', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')
    const runtimeGuard = runner.indexOf('if (isScheduledTaskRuntimeUnavailableError(error))')
    const retryContinue = runner.indexOf('continue', runtimeGuard)
    const failedStatus = runner.indexOf('status: "failed"', runtimeGuard)

    expect(runtimeGuard).toBeGreaterThan(-1)
    expect(retryContinue).toBeGreaterThan(runtimeGuard)
    expect(failedStatus).toBeGreaterThan(retryContinue)
    expect(runner).toContain('await refreshAssistantRuntimeSnapshot(nativeApi)')
  })

  it('does not generalize retry semantics after a command may have been dispatched', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')

    expect(runner).toContain('A project.create command was already dispatched.')
    expect(runner).toContain('type: "thread.delete"')
    expect(runner).toContain('throw error')
  })

  it('keeps overdue semantics while using a reason that covers runtime outages', () => {
    const runner = read('apps/desktop/src/features/projects/model/scheduledTaskRunner.ts')

    expect(runner).toContain('isScheduledTaskStale(task, now)')
    expect(runner).toContain("Cozea couldn't run this task when it was due.")
    expect(runner).not.toContain('Cozea was not running when this was due.')
  })
})
