import { describe, expect, it } from 'vitest'

import { isBillingError, parseBillingError } from '../src/lib/ai/billingErrors'

describe('billing error parsing', () => {
  it('parses entitlement payloads embedded in Error messages and normalizes copy', () => {
    const error = new Error(
      'Request failed: {"error":"entitlement_required","code":"ENTITLEMENT_REQUIRED","message":"AI access requires an active Pro, Max, Startup, or Enterprise subscription.","action":{"label":"Open Billing","href":"/settings/billing"},"hint":"Start or renew billing in Settings > Billing.","details":{"totalAvailable":0,"plan":"free"}}'
    )

    const parsed = parseBillingError(error)

    expect(parsed).toEqual(
      expect.objectContaining({
        error: 'entitlement_required',
        code: 'ENTITLEMENT_REQUIRED',
        title: 'AI access requires a paid plan',
        message: "Your current workspace plan doesn't include AI access.",
        hint: 'Open Settings > Billing to start or renew a plan.',
        action: { label: 'Open Billing', href: '/settings/billing' },
      })
    )
  })

  it('maps seat-assignment entitlement errors to human-readable text', () => {
    const parsed = parseBillingError({
      error: 'entitlement_required',
      code: 'ENTITLEMENT_REQUIRED',
      message: 'You are not assigned to a paid seat in this workspace yet.',
      hint: 'Ask your billing owner to assign you a seat from Settings > Billing.',
      details: {
        totalAvailable: 1,
        plan: 'startup',
      },
    })

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'AI seat required',
        message: "You don't have an AI seat assigned in this workspace yet.",
        hint: 'Ask a billing admin to assign you a seat in Settings > Billing.',
      })
    )
  })

  it('detects billing errors from plain message strings', () => {
    expect(isBillingError('provider_auth_required')).toBe(true)
    expect(isBillingError('network timeout')).toBe(false)
  })
})
