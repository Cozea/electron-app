import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMockState = vi.hoisted(() => ({
  userDataPath: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMockState.userDataPath,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
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

import { rememberProjectPath } from '../../electron/projectPathRegistry'
import { __workbenchSessionTestUtils } from '../../electron/services/WorkbenchSessionManager'

function createDirectory(name: string): string {
  const directory = path.join(electronMockState.userDataPath, name)
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

describe('workbench session ownership', () => {
  beforeEach(() => {
    electronMockState.userDataPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cozea-workbench-session-'),
    )
  })

  afterEach(() => {
    fs.rmSync(electronMockState.userDataPath, { recursive: true, force: true })
  })

  it('rewrites a mismatched project path to the registered owner path', () => {
    const projectPath = createDirectory('project-a')
    const foreignPath = createDirectory('project-b')
    rememberProjectPath('rewrite-project-a', projectPath)
    rememberProjectPath('rewrite-project-b', foreignPath)

    const events: Array<{ event: string; details: Record<string, unknown> }> = []
    const resolvedPath = __workbenchSessionTestUtils.resolveOwnedProjectPath({
      projectId: 'rewrite-project-a',
      projectPath: foreignPath,
      warn: (event, details) => events.push({ event, details }),
    })

    expect(resolvedPath).toBe(projectPath)
    expect(events[0]?.event).toBe('project_path_rewritten_to_registered_owner')
  })

  it('rejects a path owned by another project when the current project has no registered path', () => {
    const foreignPath = createDirectory('foreign-project')
    rememberProjectPath('foreign-owner-project', foreignPath)

    const resolvedPath = __workbenchSessionTestUtils.resolveOwnedProjectPath({
      projectId: 'unregistered-project',
      projectPath: foreignPath,
    })

    expect(resolvedPath).toBeNull()
  })

  it('repairs persisted records into the canonical project path and collapses duplicates', () => {
    const projectPath = createDirectory('repair-project')
    const foreignPath = createDirectory('other-project')
    rememberProjectPath('repair-project', projectPath)
    rememberProjectPath('other-project', foreignPath)

    const canonicalKey = __workbenchSessionTestUtils.buildSessionKey(
      'repair-project',
      'collab',
      projectPath,
    )
    const foreignKey = __workbenchSessionTestUtils.buildSessionKey(
      'repair-project',
      'collab',
      foreignPath,
    )
    const state = {
      version: 1 as const,
      sessions: {
        [canonicalKey]: {
          projectId: 'repair-project',
          laneId: 'collab',
          projectPath,
          lifecycle: 'backgroundFrozen' as const,
          pinned: false,
          openedAt: 100,
          lastFocusedAt: 100,
          lastBackgroundedAt: 100,
        },
        [foreignKey]: {
          projectId: 'repair-project',
          laneId: 'collab',
          projectPath: foreignPath,
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
    expect(state.sessions[canonicalKey]?.projectPath).toBe(projectPath)
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
