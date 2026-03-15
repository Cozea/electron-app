import { describe, expect, it } from 'vitest'

import { getGitRouteAccessLevel } from '../server/src/lib/gitRouteAccess'

describe('git route access level', () => {
  it('treats clone and fetch endpoints as read access', () => {
    expect(
      getGitRouteAccessLevel({
        method: 'GET',
        suffix: '/info/refs',
        query: 'service=git-upload-pack',
      })
    ).toBe('read')

    expect(
      getGitRouteAccessLevel({
        method: 'POST',
        suffix: '/git-upload-pack',
        query: '',
      })
    ).toBe('read')

    expect(
      getGitRouteAccessLevel({
        method: 'GET',
        suffix: '/objects/info/packs',
        query: '',
      })
    ).toBe('read')
  })

  it('treats push endpoints as write access', () => {
    expect(
      getGitRouteAccessLevel({
        method: 'GET',
        suffix: '/info/refs',
        query: 'service=git-receive-pack',
      })
    ).toBe('write')

    expect(
      getGitRouteAccessLevel({
        method: 'POST',
        suffix: '/git-receive-pack',
        query: '',
      })
    ).toBe('write')
  })

  it('fails closed for other mutating requests', () => {
    expect(
      getGitRouteAccessLevel({
        method: 'POST',
        suffix: '/hooks/update',
        query: '',
      })
    ).toBe('write')
  })
})
