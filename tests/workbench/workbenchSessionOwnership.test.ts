import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/cozea-workbench-session-test',
    once: vi.fn(),
  },
  BrowserWindow: class {},
  WebContentsView: class {},
  session: {
    fromPartition: vi.fn(() => ({})),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

import { __workbenchSessionTestUtils } from '../../electron/services/WorkbenchSessionManager'

describe('workbench session ownership', () => {
  it('builds session keys from opaque workspace ids without path hashing', () => {
    expect(
      __workbenchSessionTestUtils.buildSessionKey(
        'project-a',
        'collab',
        ' workspace-123 ',
      ),
    ).toBe('project-a::collab::workspace-123')
  })

  it('repairs persisted records into canonical opaque workspace keys', () => {
    const canonicalKey = __workbenchSessionTestUtils.buildSessionKey(
      'repair-project',
      'collab',
      'workspace-a',
    )
    const staleKey = 'repair-project::collab::old-path-derived-key'
    const state = {
      version: 1 as const,
      sessions: {
        [staleKey]: {
          projectId: 'repair-project',
          laneId: 'collab',
          workspaceId: ' workspace-a ',
          lifecycle: 'backgroundFrozen' as const,
          pinned: false,
          openedAt: 100,
          lastFocusedAt: 100,
          lastBackgroundedAt: 100,
        },
      },
    }

    const changed = __workbenchSessionTestUtils.repairPersistedSessionState(state)

    expect(changed).toBe(true)
    expect(Object.keys(state.sessions)).toEqual([canonicalKey])
    expect(state.sessions[canonicalKey]?.workspaceId).toBe('workspace-a')
  })

  it('collapses duplicate persisted workspace records by latest focus time', () => {
    const canonicalKey = __workbenchSessionTestUtils.buildSessionKey(
      'repair-project',
      'collab',
      'workspace-a',
    )
    const state = {
      version: 1 as const,
      sessions: {
        [canonicalKey]: {
          projectId: 'repair-project',
          laneId: 'collab',
          workspaceId: 'workspace-a',
          lifecycle: 'backgroundFrozen' as const,
          pinned: false,
          openedAt: 100,
          lastFocusedAt: 100,
          lastBackgroundedAt: 100,
        },
        'repair-project::collab::duplicate': {
          projectId: 'repair-project',
          laneId: 'collab',
          workspaceId: ' workspace-a ',
          lifecycle: 'backgroundFrozen' as const,
          pinned: false,
          openedAt: 200,
          lastFocusedAt: 200,
          lastBackgroundedAt: 200,
        },
      },
    }

    const changed = __workbenchSessionTestUtils.repairPersistedSessionState(state)

    expect(changed).toBe(true)
    expect(Object.keys(state.sessions)).toEqual([canonicalKey])
    expect(state.sessions[canonicalKey]?.lastFocusedAt).toBe(200)
  })

  it('selects every duplicate session for project-lane close calls', () => {
    const sessions = new Map([
      ['target-a', { projectId: 'close-project', laneId: 'collab' }],
      ['target-b', { projectId: 'close-project', laneId: 'collab' }],
      ['other-lane', { projectId: 'close-project', laneId: 'branch:main' }],
      ['other-project', { projectId: 'other-project', laneId: 'collab' }],
    ])

    expect(
      __workbenchSessionTestUtils.findSessionKeysByProjectLane(sessions.entries(), {
        projectId: 'close-project',
        laneId: 'collab',
      }),
    ).toEqual(['target-a', 'target-b'])
  })
})
