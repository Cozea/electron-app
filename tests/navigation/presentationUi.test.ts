import { describe, expect, it } from 'vitest'
import {
  MAX_WORKBENCH_KEEP_ALIVE_SESSIONS,
  selectWorkbenchKeepAliveSessions,
  type WorkbenchKeepAliveSession,
} from '@/features/workbench/workbenchKeepAlive'
import { buildPresentationInstanceKey } from '@shared/navigationRuntimeTypes'

function session(name: string, revision = 1, lastActiveAt = 1): WorkbenchKeepAliveSession {
  const identity = { projectId: `project-${name}`, workspaceId: `workspace-${name}`, workspaceRevision: revision, laneId: 'collab' }
  return {
    instanceKey: buildPresentationInstanceKey(identity), scopeKey: `${name}::scope`,
    projectId: identity.projectId, activeLaneId: identity.laneId, workspaceId: identity.workspaceId,
    workspaceRevision: revision, projectRootPath: `/tmp/${name}`, gitRootPath: `/tmp/${name}`,
    projectName: name, framework: null, storedDevCommand: null, storedDevPort: null,
    workbenchSessionKey: `${name}::session`, themeScheme: 'dark', lastActiveAt,
  }
}

describe('live workbench retention policy', () => {
  it('keeps A resident across ordinary-route departure and return', () => {
    const a = session('a', 1, 1)
    const residents = selectWorkbenchKeepAliveSessions(a, [])
    expect(selectWorkbenchKeepAliveSessions({ ...a, lastActiveAt: 2 }, residents)).toHaveLength(1)
  })

  it('retains a bounded LRU working set', () => {
    let residents: WorkbenchKeepAliveSession[] = []
    for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) {
      residents = selectWorkbenchKeepAliveSessions(session(name, 1, index + 1), residents)
    }
    expect(residents).toHaveLength(MAX_WORKBENCH_KEEP_ALIVE_SESSIONS)
    expect(residents.map(value => value.projectName)).toEqual(['d', 'c', 'b'])
  })

  it('replaces a stale binding revision instead of retaining both instances', () => {
    const oldBinding = session('a', 1, 1)
    const newBinding = session('a', 2, 2)
    expect(selectWorkbenchKeepAliveSessions(newBinding, [oldBinding])).toEqual([newBinding])
    expect(newBinding.instanceKey).not.toBe(oldBinding.instanceKey)
  })
})
