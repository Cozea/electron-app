import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildWorkbenchLaneSidebarSummary,
  buildWorkbenchScopeKey,
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
        },
      ],
    })
  })
})
