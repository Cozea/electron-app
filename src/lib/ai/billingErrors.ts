export interface BillingErrorAction {
  label: string
  href: string
}

export interface ParsedBillingError {
  error: string
  code?: string
  title: string
  message: string
  hint?: string
  action?: BillingErrorAction
}

const BILLING_ERROR_CODES = new Set([
  'entitlement_required',
  'wallet_insufficient_funds',
  'provider_auth_required',
])

function normalizeBillingAction(action: unknown): BillingErrorAction | undefined {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return undefined
  }

  const candidate = action as Record<string, unknown>
  const href = typeof candidate.href === 'string' ? candidate.href : undefined
  if (!href) {
    return undefined
  }

  const normalizedHref = href.includes('?') ? href : `${href}?plans=1`
  return {
    label: 'Billing',
    href: normalizedHref,
  }
}

function extractStructuredPayload(input: unknown): Record<string, unknown> | null {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
        ? input
        : null

  if (!raw && input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (!raw) {
    return null
  }

  const jsonStart = raw.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }

  const normalized = raw.trim()
  if (BILLING_ERROR_CODES.has(normalized)) {
    return { error: normalized }
  }

  return null
}

export function parseBillingError(input: unknown): ParsedBillingError | null {
  const payload = extractStructuredPayload(input)
  if (!payload) {
    return null
  }

  const error = typeof payload.error === 'string' ? payload.error : null
  if (!error || !BILLING_ERROR_CODES.has(error)) {
    return null
  }

  const code = typeof payload.code === 'string' ? payload.code : undefined
  const message = typeof payload.message === 'string' ? payload.message : ''
  const hint = typeof payload.hint === 'string' ? payload.hint : undefined
  const action = normalizeBillingAction(payload.action)

  if (
    error === 'entitlement_required' &&
    /assigned to a paid seat/i.test(message)
  ) {
    return {
      error,
      code,
      title: 'AI seat required',
      message: "You don't have an AI seat assigned in this workspace yet.",
      hint: 'Ask a billing admin to assign you a seat in Settings > Billing.',
      action,
    }
  }

  if (error === 'entitlement_required') {
    return {
      error,
      code,
      title: 'Paid Plan Required',
      message: 'Cozea agents are only in paid plans.',
      hint: undefined,
      action,
    }
  }

  if (error === 'wallet_insufficient_funds') {
    return {
      error,
      code,
      title: 'Not Enough Balance',
      message: 'Subscription credits exhausted.',
      hint,
      action,
    }
  }

  return {
    error,
    code,
    title: 'Provider authentication required',
    message: 'Reconnect the required provider before retrying this action.',
    hint,
    action,
  }
}

export function isBillingError(input: unknown): boolean {
  return parseBillingError(input) !== null
}
