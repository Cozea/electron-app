import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readScopedProjectBranchSession,
  rememberProjectBranchSession,
} from '@/features/source-control/model/projectBranchSessionStore'

const STORAGE_KEY = 'cozea:project-branch-sessions:v1'
const PROJECT_ID = 'm57dgeksm5v2xbamggp41nxfqd8e08ex'
const WORKSPACE_ID = 'lws_11590ea144894a4ebc3919aa217378c0'

// The suite runs in the node environment, where the store's `typeof window`
// guard short-circuits every read and write. The setup file already installs a
// working `globalThis.localStorage`; hand the store a `window` that points at it.
beforeEach(() => {
  globalThis.localStorage.clear()
  vi.stubGlobal('window', { localStorage: globalThis.localStorage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project branch session collabBranch migration', () => {
  // v2 records were written by a build that answered "main" whenever a project
  // recorded no default branch. A local repo on `master` was therefore persisted
  // as though `main` were shared, which pinned lane ids to a branch lane for the
  // life of the record. Trusting that stored value would have survived the fix.
  it('clears a v2 collabBranch so it is relearned instead of trusted', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        sessions: {
          [`${PROJECT_ID}::${WORKSPACE_ID}`]: {
            projectId: PROJECT_ID,
            activeBranch: 'master',
            collabBranch: 'main',
            workspaceId: WORKSPACE_ID,
            updatedAt: 1788980998632,
          },
        },
      }),
    )

    const session = readScopedProjectBranchSession(PROJECT_ID, WORKSPACE_ID)

    expect(session).not.toBeNull()
    expect(session?.collabBranch).toBeNull()
    // The active branch is still fresh truth and must survive the migration.
    expect(session?.activeBranch).toBe('master')
  })

  it('clears a legacy v1 collabBranch as well', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        projects: {
          [PROJECT_ID]: {
            projectId: PROJECT_ID,
            activeBranch: 'master',
            collabBranch: 'main',
            projectPath: WORKSPACE_ID,
            updatedAt: 1788980998632,
          },
        },
      }),
    )

    expect(readScopedProjectBranchSession(PROJECT_ID, WORKSPACE_ID)?.collabBranch).toBeNull()
  })

  it('keeps a collabBranch that was learned after the migration', () => {
    rememberProjectBranchSession({
      projectId: PROJECT_ID,
      branch: 'master',
      collabBranch: 'master',
      workspaceId: WORKSPACE_ID,
    })

    const session = readScopedProjectBranchSession(PROJECT_ID, WORKSPACE_ID)

    expect(session?.collabBranch).toBe('master')
    expect(session?.activeBranch).toBe('master')
  })
})
