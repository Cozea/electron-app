import { describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({
  fork: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  fork: childProcess.fork,
}))

import { WorkbenchRuntimeClient } from '../../apps/desktop/electron/services/WorkbenchRuntimeClient'

describe('WorkbenchRuntimeClient shutdown', () => {
  it('does not fork a replacement child after disposal', async () => {
    const client = WorkbenchRuntimeClient.getInstance()
    client.dispose()

    await expect(client.request('terminal.getProfiles', {})).rejects.toThrow(
      'Workbench runtime client is disposed.',
    )
    expect(childProcess.fork).not.toHaveBeenCalled()
  })
})
