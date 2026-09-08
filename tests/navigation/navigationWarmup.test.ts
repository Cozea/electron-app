import { describe, expect, it } from 'vitest'

import { resolveNavigationWarmDestination } from '@/lib/navigationWarmup'

describe('navigation destination warming', () => {
  it.each([
    '/workbench',
    '/projects/p/project-a/workbench',
    '/projects/example/workbench',
    '/projects/p/project-a/workbench?tile=assistant',
  ])('maps %s to the registered workbench loader', (pathname) => {
    expect(resolveNavigationWarmDestination(pathname)).toBe('workbench')
  })

  it('preserves non-workbench destination keys', () => {
    expect(resolveNavigationWarmDestination('/projects/store')).toBe('/projects/store')
  })
})
