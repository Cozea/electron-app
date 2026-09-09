import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildBranchSessionLaneId,
  resolveCollabBranchKnowledge,
  resolveLaneBranchKnowledge,
} from '@/features/source-control/model/projectBranchSessionStore'
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import {
  migratePersistedWorkbenchState,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"

describe('resolveLaneBranchKnowledge', () => {
  it('uses a fresh git branch and asks to persist it', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: true, isRepo: true, currentBranch: 'master' },
        storedBranch: null,
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'master', remember: true })
  })

  it('resolves non-repos to the collab branch without persisting', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: true, isRepo: false },
        storedBranch: null,
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'main', remember: false })
  })

  it('ignores a stale stored branch when git confirms the workspace is not a repo', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: true, isRepo: false, currentBranch: undefined },
        storedBranch: 'feature/old',
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'main', remember: false })
  })

  it('keeps the stored branch when git status fails transiently', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: false, isRepo: false, currentBranch: undefined },
        storedBranch: 'master',
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'master', remember: false })
  })

  it('keeps the stored branch when the IPC call rejects entirely', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: null,
        storedBranch: 'master',
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'master', remember: false })
  })

  it('stays unresolved on transient failure with no prior knowledge', () => {
    // The old fallback fabricated collabBranch here, flipping the bench key
    // to "collab" and stranding every open tile under "branch:<real>".
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: false, isRepo: false },
        storedBranch: null,
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'unresolved' })
    expect(
      resolveLaneBranchKnowledge({
        statusResult: null,
        storedBranch: null,
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'unresolved' })
  })

  it('resolves a branchless repo (detached/unborn HEAD) to collab without persisting', () => {
    expect(
      resolveLaneBranchKnowledge({
        statusResult: { success: true, isRepo: true, currentBranch: undefined },
        storedBranch: null,
        collabBranch: 'main',
      }),
    ).toEqual({ kind: 'resolved', branch: 'main', remember: false })
  })
})

describe('persisted workbench ghost-sibling prune', () => {
  beforeEach(() => {
    useProjectWorkbenchStore.setState({ workbenches: {} })
  })

  it('drops a selection-only lane sibling when another lane holds real tiles', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    // The real bench, with content, under the branch lane.
    actions.ensureWorkbench('project-1', 'branch:master', 'ws-a')
    actions.addTile('project-1', 'branch:master', 'terminal', { title: 'shell' }, 'ws-a')
    // The ghost minted by a mis-resolved collab lane: selection tile only.
    actions.ensureWorkbench('project-1', 'collab', 'ws-a')

    const migrated = migratePersistedWorkbenchState(
      JSON.parse(JSON.stringify({ workbenches: useProjectWorkbenchStore.getState().workbenches })),
    )

    const keys = Object.keys(migrated.workbenches)
    expect(keys).toContain(buildWorkbenchScopeKey('project-1', 'branch:master', 'ws-a'))
    expect(keys).not.toContain(buildWorkbenchScopeKey('project-1', 'collab', 'ws-a'))
  })

  it('keeps multiple lane benches when each holds real tiles (per-branch feature)', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'branch:feature', 'ws-a')
    actions.addTile('project-1', 'branch:feature', 'terminal', { title: 'shell' }, 'ws-a')
    actions.ensureWorkbench('project-1', 'collab', 'ws-a')
    actions.addTile('project-1', 'collab', 'assistantChat', { title: 'chat' }, 'ws-a')

    const migrated = migratePersistedWorkbenchState(
      JSON.parse(JSON.stringify({ workbenches: useProjectWorkbenchStore.getState().workbenches })),
    )

    const keys = Object.keys(migrated.workbenches)
    expect(keys).toContain(buildWorkbenchScopeKey('project-1', 'branch:feature', 'ws-a'))
    expect(keys).toContain(buildWorkbenchScopeKey('project-1', 'collab', 'ws-a'))
  })

  it('keeps a lone selection-only bench (fresh project, nothing to confuse it with)', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab', 'ws-a')

    const migrated = migratePersistedWorkbenchState(
      JSON.parse(JSON.stringify({ workbenches: useProjectWorkbenchStore.getState().workbenches })),
    )

    expect(Object.keys(migrated.workbenches)).toContain(
      buildWorkbenchScopeKey('project-1', 'collab', 'ws-a'),
    )
  })

  it('scopes the prune per workspace: a ghost in ws-b survives content in ws-a', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'branch:master', 'ws-a')
    actions.addTile('project-1', 'branch:master', 'terminal', { title: 'shell' }, 'ws-a')
    actions.ensureWorkbench('project-1', 'collab', 'ws-b')

    const migrated = migratePersistedWorkbenchState(
      JSON.parse(JSON.stringify({ workbenches: useProjectWorkbenchStore.getState().workbenches })),
    )

    expect(Object.keys(migrated.workbenches)).toContain(
      buildWorkbenchScopeKey('project-1', 'collab', 'ws-b'),
    )
  })
})

describe('resolveCollabBranchKnowledge', () => {
  it('prefers a branch the project records', () => {
    expect(
      resolveCollabBranchKnowledge({
        recordedDefaultBranch: 'develop',
        storedCollabBranch: 'main',
        statusResult: { success: true, isRepo: true, currentBranch: 'feature/x' },
      }),
    ).toBe('develop')
  })

  // The bug this guards: a local-only repo records no default branch, so the
  // collab branch used to be a hardcoded "main". Compared against a real
  // `master` the two never matched, and the first commit moved the workbench to
  // a branch lane, leaving the agent tile behind in a lane nothing reopened.
  it('adopts the repo branch on a first sighting when nothing is recorded', () => {
    expect(
      resolveCollabBranchKnowledge({
        recordedDefaultBranch: null,
        storedCollabBranch: null,
        statusResult: { success: true, isRepo: true, currentBranch: 'master' },
      }),
    ).toBe('master')
  })

  it('keeps a local-only repo on its own collab lane after the first commit', () => {
    const collabBranch = resolveCollabBranchKnowledge({
      recordedDefaultBranch: null,
      storedCollabBranch: null,
      statusResult: { success: true, isRepo: true, currentBranch: 'master' },
    })
    const activeBranch = resolveLaneBranchKnowledge({
      statusResult: { success: true, isRepo: true, currentBranch: 'master' },
      storedBranch: null,
      collabBranch,
    })

    expect(activeBranch).toEqual({ kind: 'resolved', branch: 'master', remember: true })
    expect(buildBranchSessionLaneId('master', collabBranch)).toBe('collab')
  })

  it('holds the learned branch steady so a real checkout still opens a branch lane', () => {
    const collabBranch = resolveCollabBranchKnowledge({
      recordedDefaultBranch: null,
      storedCollabBranch: 'master',
      statusResult: { success: true, isRepo: true, currentBranch: 'feature/x' },
    })

    expect(collabBranch).toBe('master')
    expect(buildBranchSessionLaneId('feature/x', collabBranch)).toBe('branch:feature%2Fx')
  })

  it('falls back to main only when nothing knows anything', () => {
    expect(
      resolveCollabBranchKnowledge({
        recordedDefaultBranch: null,
        storedCollabBranch: null,
        statusResult: { success: false },
      }),
    ).toBe('main')
  })
})
