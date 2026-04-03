import { describe, expect, it } from 'vitest'

import { selectProjectRuntimeState } from '../src/stores/useProjectRuntimeStore'

describe('project runtime store selector', () => {
  it('returns a stable empty snapshot when no project path is set', () => {
    const selector = selectProjectRuntimeState(null)
    const state = { projects: {} } as Parameters<typeof selector>[0]

    expect(selector(state)).toBe(selector(state))
  })

  it('returns a stable empty snapshot when the project has not emitted runtime state yet', () => {
    const selector = selectProjectRuntimeState('/tmp/example')
    const state = { projects: {} } as Parameters<typeof selector>[0]

    expect(selector(state)).toBe(selector(state))
  })
})
