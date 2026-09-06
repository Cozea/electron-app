import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncServerReadModel: vi.fn(),
  applyOrchestrationDomainEvents: vi.fn(),
  flushPendingAssistantProjectDeletions: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/assistant/model/assistantStore', () => ({
  useStore: {
    getState: () => ({
      threadsHydrated: true,
      syncServerReadModel: mocks.syncServerReadModel,
      applyOrchestrationDomainEvents: mocks.applyOrchestrationDomainEvents,
    }),
  },
  coalesceOrchestrationUiEvents: (events: unknown[]) => events,
}))

vi.mock('@/features/assistant/services/assistantProjectDeletion', () => ({
  flushPendingAssistantProjectDeletions: mocks.flushPendingAssistantProjectDeletions,
}))

vi.mock('@/features/assistant/model/orchestrationRecovery', () => ({
  createOrchestrationRecoveryCoordinator: () => ({
    beginSnapshotRecovery: vi.fn(() => false),
    completeSnapshotRecovery: vi.fn(() => false),
    markEventBatchApplied: vi.fn(() => []),
    classifyDomainEvent: vi.fn(() => 'ignore'),
    failSnapshotRecovery: vi.fn(),
    failReplayRecovery: vi.fn(),
  }),
}))

vi.mock('@/lib/nativeApi', () => ({
  ensureNativeApi: vi.fn(() => {
    throw new Error('test requires an explicit NativeApi')
  }),
}))

import type { NativeApi } from '@cozea/assistant-contracts'
import { refreshAssistantRuntimeSnapshot } from '../../apps/desktop/src/features/workbench/useAssistantRuntimeSync'
import { isScheduledTaskRuntimeUnavailableError } from '../../apps/desktop/src/features/projects/model/scheduledTaskRuntime'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function snapshot(id: string, sequence: number) {
  return {
    snapshotSequence: sequence,
    projects: [
      {
        id,
        title: id,
        workspaceRoot: `/${id}`,
        defaultModelSelection: null,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    threads: [],
    updatedAt: '2026-09-06T00:00:00.000Z',
  } as any
}

function apiWithSnapshot(getSnapshot: () => Promise<any>): NativeApi {
  return {
    orchestration: {
      getSnapshot,
      onDomainEvent: () => () => undefined,
    },
  } as unknown as NativeApi
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assistant runtime snapshot refresh isolation', () => {
  it('does not let an in-flight refresh from API A satisfy API B', async () => {
    const pendingA = deferred<any>()
    const pendingB = deferred<any>()
    const getSnapshotA = vi.fn(() => pendingA.promise)
    const getSnapshotB = vi.fn(() => pendingB.promise)
    const apiA = apiWithSnapshot(getSnapshotA)
    const apiB = apiWithSnapshot(getSnapshotB)

    const refreshA = refreshAssistantRuntimeSnapshot(apiA)
    const refreshB = refreshAssistantRuntimeSnapshot(apiB)

    expect(getSnapshotA).toHaveBeenCalledTimes(1)
    expect(getSnapshotB).toHaveBeenCalledTimes(1)

    pendingB.resolve(snapshot('project-b', 2))
    await expect(refreshB).resolves.toMatchObject({
      snapshotSequence: 2,
      projects: [{ id: 'project-b' }],
    })

    pendingA.resolve(snapshot('project-a', 1))
    await expect(refreshA).resolves.toMatchObject({
      snapshotSequence: 1,
      projects: [{ id: 'project-a' }],
    })
  })

  it('coalesces overlapping refresh requests that share the same API', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    const getSnapshot = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const api = apiWithSnapshot(getSnapshot)

    const refreshOne = refreshAssistantRuntimeSnapshot(api)
    const refreshTwo = refreshAssistantRuntimeSnapshot(api)

    expect(getSnapshot).toHaveBeenCalledTimes(1)
    first.resolve(snapshot('project-first', 1))
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2))

    second.resolve(snapshot('project-second', 2))
    await expect(refreshOne).resolves.toMatchObject({ snapshotSequence: 2 })
    await expect(refreshTwo).resolves.toMatchObject({ snapshotSequence: 2 })
  })

  it('keeps snapshot transport failures non-retryable for scheduled tasks', async () => {
    const transportError = new Error('snapshot transport failed')
    const api = apiWithSnapshot(vi.fn().mockRejectedValue(transportError))

    await expect(refreshAssistantRuntimeSnapshot(api)).rejects.toBe(transportError)
    expect(isScheduledTaskRuntimeUnavailableError(transportError)).toBe(false)
  })
})
