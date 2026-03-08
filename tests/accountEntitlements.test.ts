import { describe, expect, it } from 'vitest'

import { isAccountStatusEntitled } from '../convex/lib/accountEntitlements'

describe('account entitlement status', () => {
  it('treats past-due subscriptions as inactive for access', () => {
    expect(isAccountStatusEntitled('past_due')).toBe(false)
  })

  it('keeps active and trialing subscriptions entitled', () => {
    expect(isAccountStatusEntitled('active')).toBe(true)
    expect(isAccountStatusEntitled('trialing')).toBe(true)
  })
})
