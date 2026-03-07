import { describe, expect, it } from 'vitest'

import {
  isConfirmedReplacementStatus,
  resolvePendingAccountCycleChange,
  resolveStoredAccountSubscriptionStatus,
  resolveReplacementStripeSubscriptionId,
  shouldSkipFundingOnSubscriptionUpdate,
  shouldIgnoreAccountSubscriptionCancellation,
  shouldIgnoreStaleAccountSubscriptionEvent,
} from '../server/src/lib/billingSwitch'

describe('billing plan switching helpers', () => {
  it('marks active paid subscriptions as replaceable during checkout', () => {
    expect(
      resolveReplacementStripeSubscriptionId({
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_current',
      })
    ).toBe('sub_current')
  })

  it('does not replace free or canceled subscriptions', () => {
    expect(
      resolveReplacementStripeSubscriptionId({
        plan: 'free',
        status: 'active',
        stripeSubscriptionId: 'sub_free',
      })
    ).toBeUndefined()

    expect(
      resolveReplacementStripeSubscriptionId({
        plan: 'max',
        status: 'canceled',
        stripeSubscriptionId: 'sub_old',
      })
    ).toBeUndefined()
  })

  it('accepts a confirmed replacement update for the current subscription', () => {
    expect(
      shouldIgnoreStaleAccountSubscriptionEvent({
        currentSubscription: {
          status: 'active',
          stripeSubscriptionId: 'sub_old',
        },
        incomingStripeSubscriptionId: 'sub_new',
        incomingStatus: 'trialing',
        replacesStripeSubscriptionId: 'sub_old',
      })
    ).toBe(false)
  })

  it('ignores stale updates from an older subscription once a new one is current', () => {
    expect(
      shouldIgnoreStaleAccountSubscriptionEvent({
        currentSubscription: {
          status: 'active',
          stripeSubscriptionId: 'sub_new',
        },
        incomingStripeSubscriptionId: 'sub_old',
        incomingStatus: 'active',
        replacesStripeSubscriptionId: undefined,
      })
    ).toBe(true)
  })

  it('does not replace the current subscription with an unconfirmed replacement status', () => {
    expect(isConfirmedReplacementStatus('past_due')).toBe(false)

    expect(
      shouldIgnoreStaleAccountSubscriptionEvent({
        currentSubscription: {
          status: 'active',
          stripeSubscriptionId: 'sub_old',
        },
        incomingStripeSubscriptionId: 'sub_new',
        incomingStatus: 'past_due',
        replacesStripeSubscriptionId: 'sub_old',
      })
    ).toBe(true)
  })

  it('ignores cancellation events for non-current subscriptions', () => {
    expect(
      shouldIgnoreAccountSubscriptionCancellation({
        currentSubscription: {
          status: 'trialing',
          stripeSubscriptionId: 'sub_new',
        },
        incomingStripeSubscriptionId: 'sub_old',
      })
    ).toBe(true)
  })

  it('keeps a trial active in Stripe state when cancellation is scheduled', () => {
    expect(
      resolveStoredAccountSubscriptionStatus({
        stripeStatus: 'trialing',
        cancelAt: Date.now() + 60_000,
        cancelAtPeriodEnd: true,
      })
    ).toBe('trialing')
  })

  it('skips wallet refills for scheduled cancellations without marking the subscription canceled', () => {
    expect(
      shouldSkipFundingOnSubscriptionUpdate({
        stripeStatus: 'trialing',
        cancelAt: Date.now() + 60_000,
        cancelAtPeriodEnd: true,
      })
    ).toBe(true)
  })

  it('resolves a pending cycle change from an active subscription schedule', () => {
    expect(
      resolvePendingAccountCycleChange({
        currentSubscriptionId: 'sub_123',
        currentCycle: 'monthly',
        schedule: {
          status: 'active',
          subscriptionId: 'sub_123',
          currentPhaseEnd: 1_700_000_000,
          metadata: {
            scheduledChangeType: 'cycle_change',
            scheduledChangeCycle: 'yearly',
            scheduledChangeEffectiveAt: '1700000000',
          },
          phases: [
            {
              startDate: 1_699_000_000,
              endDate: 1_700_000_000,
              cycles: ['monthly'],
            },
            {
              startDate: 1_700_000_000,
              cycles: ['yearly'],
            },
          ],
        },
      })
    ).toEqual({
      cycle: 'yearly',
      effectiveAt: 1_700_000_000,
    })
  })

  it('ignores schedules that do not change the active billing cycle', () => {
    expect(
      resolvePendingAccountCycleChange({
        currentSubscriptionId: 'sub_123',
        currentCycle: 'yearly',
        schedule: {
          status: 'active',
          subscriptionId: 'sub_123',
          currentPhaseEnd: 1_700_000_000,
          phases: [
            {
              startDate: 1_699_000_000,
              endDate: 1_700_000_000,
              cycles: ['yearly'],
            },
            {
              startDate: 1_700_000_000,
              cycles: ['yearly'],
            },
          ],
        },
      })
    ).toBeNull()
  })
})
