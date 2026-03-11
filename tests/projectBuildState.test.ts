import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROJECT_BUILD_STATUS_MESSAGE,
  INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE,
  createInitialProjectBuildSessionState,
  parseStoredProjectBuildSessionState,
} from '../src/pages/projectBuildState'

describe('project build session state', () => {
  it('returns a clean initial state when no stored session exists', () => {
    expect(parseStoredProjectBuildSessionState(null)).toEqual(createInitialProjectBuildSessionState())
  })

  it('converts interrupted in-flight runs from storage into retryable state', () => {
    expect(
      parseStoredProjectBuildSessionState(
        JSON.stringify({
          runId: 'run_123',
          runStatus: 'running',
          runAttempt: 2,
          buildTasks: [
            {
              content: 'Install dependencies',
              activeForm: 'Installing dependencies',
              status: 'in_progress',
            },
          ],
          progress: 45,
          statusMessage: 'Still running',
          logs: ['step 1'],
        })
      )
    ).toEqual({
      runId: 'run_123',
      runStatus: 'interrupted',
      runAttempt: 2,
      buildTasks: [
        {
          content: 'Install dependencies',
          activeForm: 'Installing dependencies',
          status: 'in_progress',
        },
      ],
      progress: 45,
      statusMessage: INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE,
      logs: ['step 1'],
    })
  })

  it('falls back to the default status message when stored JSON is malformed', () => {
    expect(parseStoredProjectBuildSessionState('{bad json')).toEqual({
      runId: null,
      runStatus: 'idle',
      runAttempt: 0,
      buildTasks: [],
      progress: 0,
      statusMessage: DEFAULT_PROJECT_BUILD_STATUS_MESSAGE,
      logs: [],
    })
  })
})
