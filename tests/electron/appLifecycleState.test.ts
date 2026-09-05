import { describe, expect, it } from 'vitest'

import { shouldPreserveWindowlessRuntime } from '../../apps/desktop/electron/appLifecycleState'

describe('desktop application lifetime policy', () => {
  it('preserves user runtimes only for a normal macOS last-window close', () => {
    expect(shouldPreserveWindowlessRuntime('darwin', false)).toBe(true)
    expect(shouldPreserveWindowlessRuntime('darwin', true)).toBe(false)
    expect(shouldPreserveWindowlessRuntime('win32', false)).toBe(false)
    expect(shouldPreserveWindowlessRuntime('linux', false)).toBe(false)
  })
})
