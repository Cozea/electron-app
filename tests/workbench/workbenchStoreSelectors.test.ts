import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildWorkbenchLaneSidebarSummary,
  buildWorkbenchScopeKey,
  selectProjectLaneWorkbenches,
  selectProjectWorkbench,
  selectVisibleActiveWorkbenchTileId,
  useProjectWorkbenchStore,
} from '../../src/stores/useProjectWorkbenchStore'

describe('workbench store selectors', () => {
  beforeEach(() => {
    useProjectWorkbenchStore.setState({ workbenches: {} })
  })

  it('keeps the visible active tile null while the empty selection tile is active', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab')

    const selector = selectVisibleActiveWorkbenchTileId('project-1', 'collab')

    expect(selector(useProjectWorkbenchStore.getState())).toBeNull()
    expect(selector(useProjectWorkbenchStore.getState())).toBeNull()
  })

  it('returns the active non-selection tile id for sidebar highlighting', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab')
    const assistantTileId = actions.addTile('project-1', 'collab', 'assistantChat', {
      title: 'Planner',
    })

    const selector = selectVisibleActiveWorkbenchTileId('project-1', 'collab')

    expect(selector(useProjectWorkbenchStore.getState())).toBe(assistantTileId)
  })

  it('does not persist an invalid active tile id', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab')
    const assistantTileId = actions.addTile('project-1', 'collab', 'assistantChat', {
      title: 'Planner',
    })

    actions.setActiveTile('project-1', 'collab', 'missing-tile')

    const selector = selectVisibleActiveWorkbenchTileId('project-1', 'collab')
    expect(selector(useProjectWorkbenchStore.getState())).toBe(assistantTileId)
  })

  it('falls back to the most recently used path-scoped workbench when no path is available', async () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab', '/tmp/project-a')
    actions.addTile('project-1', 'collab', 'terminal', { title: 'Older shell' }, '/tmp/project-a')
    await new Promise((resolve) => setTimeout(resolve, 2))
    actions.ensureWorkbench('project-1', 'collab', '/tmp/project-b')
    const latestTileId = actions.addTile(
      'project-1',
      'collab',
      'assistantChat',
      { title: 'Latest agent' },
      '/tmp/project-b',
    )

    const workbench = selectProjectWorkbench('project-1', 'collab')(
      useProjectWorkbenchStore.getState(),
    )

    expect(workbench?.projectPath).toBe('/tmp/project-b')
    expect(workbench?.activeTileId).toBe(latestTileId)
  })

  it('uses the most recently used workbench for lane summaries when paths differ', async () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab', '/tmp/project-a')
    actions.addTile('project-1', 'collab', 'terminal', { title: 'Older shell' }, '/tmp/project-a')
    await new Promise((resolve) => setTimeout(resolve, 2))
    actions.ensureWorkbench('project-1', 'collab', '/tmp/project-b')
    const latestTileId = actions.addTile(
      'project-1',
      'collab',
      'assistantChat',
      { title: 'Latest agent' },
      '/tmp/project-b',
    )

    const byLane = selectProjectLaneWorkbenches('project-1')(
      useProjectWorkbenchStore.getState(),
    )

    expect(byLane.collab?.projectPath).toBe('/tmp/project-b')
    expect(byLane.collab?.activeTileId).toBe(latestTileId)
  })

  it('builds lane summaries without leaking selection tiles into sidebar rows', () => {
    const actions = useProjectWorkbenchStore.getState().actions
    actions.ensureWorkbench('project-1', 'collab')
    const assistantTileId = actions.addTile('project-1', 'collab', 'assistantChat', {
      title: 'Planner',
      threadId: 'thread-1',
    })
    const terminalTileId = actions.addTile('project-1', 'collab', 'terminal', { title: 'Shell' })

    const workbench =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey('project-1', 'collab')
      ]!

    expect(buildWorkbenchLaneSidebarSummary(workbench)).toEqual({
      laneId: 'collab',
      activeTileId: workbench.activeTileId,
      agents: [
        {
          id: assistantTileId,
          type: 'assistantChat',
          title: 'Planner',
          provider: undefined,
          threadId: 'thread-1',
        },
      ],
      surfaces: [
        {
          id: terminalTileId,
          type: 'terminal',
          title: 'Shell',
          favicon: null,
        },
      ],
    })
  })
})
