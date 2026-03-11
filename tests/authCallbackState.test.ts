import { describe, expect, it } from 'vitest'

import { signState, verifyRequiredState } from '../server/src/lib/authCallbackState'

describe('authCallbackState', () => {
  const secret = 'test-secret'

  it('rejects a callback without state', () => {
    expect(verifyRequiredState(undefined, secret)).toEqual({
      ok: false,
      error: 'Missing state parameter',
    })
  })

  it('rejects an invalid state value', () => {
    expect(verifyRequiredState('not-a-valid-state', secret)).toEqual({
      ok: false,
      error: 'Invalid state parameter',
    })
  })

  it('verifies a valid signed state', () => {
    const signedState = signState(
      {
        clientType: 'desktop',
        originalState: 'opaque-client-state',
        desktopRedirectUri: 'cozea://auth/callback',
      },
      secret,
    )

    expect(verifyRequiredState(signedState, secret)).toEqual({
      ok: true,
      state: {
        clientType: 'desktop',
        originalState: 'opaque-client-state',
        desktopRedirectUri: 'cozea://auth/callback',
        webRedirectUri: undefined,
      },
    })
  })
})
