import { describe, expect, it } from 'vitest'

import {
  resolveEffectiveIncludedWalletCents,
  resolveMaxTrialIncludedWalletCents,
} from '../../convex/lib/walletPolicy'

describe('wallet policy', () => {
  it('returns zero included usage for canceled subscriptions', () => {
    expect(
      resolveEffectiveIncludedWalletCents({
        plan: 'max',
        cycle: 'monthly',
        status: 'canceled',
      })
    ).toBe(0)
  })

  it('returns zero included usage for past-due subscriptions', () => {
    expect(
      resolveEffectiveIncludedWalletCents({
        plan: 'max',
        cycle: 'monthly',
        status: 'past_due',
      })
    ).toBe(0)
  })

  it('keeps the limited trial allocation for active max trials', () => {
    expect(
      resolveEffectiveIncludedWalletCents({
        plan: 'max',
        cycle: 'monthly',
        status: 'trialing',
      })
    ).toBe(resolveMaxTrialIncludedWalletCents({ cycle: 'monthly' }))
  })
})
