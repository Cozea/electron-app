import { describe, expect, it } from 'vitest'

import {
  MAX_DEV_SERVER_AUXILIARY_PROCESSES,
  normalizeDevServerAuxiliaryProcesses,
  useDevServerProcessConfigStore,
} from '@/features/projects/devserver/devServerProcessConfigStore'

describe('Dev Server project-local process configuration', () => {
  it('normalizes, bounds, and de-duplicates persisted process entries', () => {
    const processes = Array.from({ length: MAX_DEV_SERVER_AUXILIARY_PROCESSES + 2 }, (_, index) => ({
      id: index === 1 ? 'process-0' : `process-${index}`,
      name: ` Service ${index} `,
      command: ' bun run dev ',
      cwd: 'ignored-legacy-subdirectory',
    }))

    expect(normalizeDevServerAuxiliaryProcesses(processes)).toEqual([
      {
        id: 'process-0',
        name: 'Service 0',
        command: 'bun run dev',
      },
      ...Array.from({ length: MAX_DEV_SERVER_AUXILIARY_PROCESSES - 2 }, (_, index) => ({
        id: `process-${index + 2}`,
        name: `Service ${index + 2}`,
        command: 'bun run dev',
      })),
    ])
  })

  it('keeps configurations isolated by workspace and clears only the requested workspace', () => {
    const firstWorkspace = `workspace-${crypto.randomUUID()}`
    const secondWorkspace = `workspace-${crypto.randomUUID()}`
    const process = [{ id: 'backend', name: 'Backend', command: 'bun run api' }]
    const actions = useDevServerProcessConfigStore.getState().actions

    actions.setForWorkspace(firstWorkspace, process)
    actions.setForWorkspace(secondWorkspace, process)
    actions.clearWorkspace(firstWorkspace)

    const state = useDevServerProcessConfigStore.getState()
    expect(state.byWorkspace[firstWorkspace]).toBeUndefined()
    expect(state.byWorkspace[secondWorkspace]).toEqual(process)
  })
})
