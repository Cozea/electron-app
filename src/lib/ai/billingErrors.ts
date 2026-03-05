export interface BillingErrorData {
  error: string
  code?: string
  title?: string
  message?: string
  action?: {
    label: string
    href: string
  }
  secondaryAction?: {
    label: string
    href: string
  }
  hint?: string
  details?: {
    totalAvailable?: number
    plan?: string
  }
}

const BILLING_CODE_BY_ERROR: Record<string, string> = {
  billing_error: 'SUBSCRIPTION_REQUIRED',
  subscription_required: 'SUBSCRIPTION_REQUIRED',
  subscription_inactive: 'SUBSCRIPTION_INACTIVE',
  tier_not_available: 'TIER_NOT_AVAILABLE',
  model_restricted: 'MODEL_RESTRICTED',
  provider_restricted: 'PROVIDER_RESTRICTED',
  provider_auth_required: 'PROVIDER_AUTH_REQUIRED',
  invalid_model_id: 'MODEL_CONFIGURATION_REQUIRED',
  provider_model_mismatch: 'MODEL_CONFIGURATION_REQUIRED',
  provider_auth_provider_mismatch: 'MODEL_CONFIGURATION_REQUIRED',
  entitlement_required: 'ENTITLEMENT_REQUIRED',
  wallet_insufficient_funds: 'WALLET_INSUFFICIENT_FUNDS',
}

const BILLING_CODES = new Set<string>(Object.values(BILLING_CODE_BY_ERROR))

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAction(value: unknown): { label: string; href: string } | undefined {
  if (!isRecord(value)) return undefined
  const label = asNonEmptyString(value.label)
  const href = asNonEmptyString(value.href)
  if (!label || !href) return undefined
  return { label, href }
}

function parseDetails(value: unknown): BillingErrorData['details'] | undefined {
  if (!isRecord(value)) return undefined
  const totalAvailable =
    typeof value.totalAvailable === 'number' && Number.isFinite(value.totalAvailable)
      ? value.totalAvailable
      : undefined
  const plan = asNonEmptyString(value.plan)
  if (typeof totalAvailable !== 'number' && !plan) return undefined
  return { totalAvailable, plan }
}

function extractErrorMessage(err: unknown): string | undefined {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return undefined
}

function parseJsonRecordFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const candidates: string[] = [trimmed]
  const braceIndex = trimmed.indexOf('{')
  if (braceIndex > 0 && braceIndex < trimmed.length) {
    candidates.push(trimmed.slice(braceIndex))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    } catch {
      // Ignore parse errors and keep trying candidates.
    }
  }

  return null
}

function resolveBillingCode(error?: string, code?: string): string | undefined {
  const normalizedCode = asNonEmptyString(code)?.toUpperCase()
  if (normalizedCode && BILLING_CODES.has(normalizedCode)) {
    return normalizedCode
  }

  const normalizedError = asNonEmptyString(error)?.toLowerCase()
  if (!normalizedError) return undefined
  return BILLING_CODE_BY_ERROR[normalizedError]
}

function resolveBillingErrorName(error?: string, code?: string): string {
  const normalizedError = asNonEmptyString(error)?.toLowerCase()
  if (normalizedError && BILLING_CODE_BY_ERROR[normalizedError]) {
    return normalizedError
  }

  const normalizedCode = resolveBillingCode(error, code)
  if (!normalizedCode) return normalizedError || 'billing_error'

  for (const [errorName, mappedCode] of Object.entries(BILLING_CODE_BY_ERROR)) {
    if (mappedCode === normalizedCode) {
      return errorName
    }
  }

  return normalizedError || 'billing_error'
}

function withFallbackAction(
  current: BillingErrorData,
  fallback: { label: string; href: string }
): BillingErrorData {
  if (current.action) return current
  return { ...current, action: fallback }
}

function normalizeEntitlementCopy(error: BillingErrorData): BillingErrorData {
  const rawMessage = `${error.message || ''} ${error.hint || ''}`.toLowerCase()
  const plan = error.details?.plan?.toLowerCase()
  const availableSeats = error.details?.totalAvailable

  const looksLikeSeatAssignment =
    rawMessage.includes('not assigned to a paid seat') ||
    rawMessage.includes('assign you a seat')
  const looksLikeSeatsExhausted =
    rawMessage.includes('all paid seats are currently assigned') ||
    rawMessage.includes('increase seat quantity') ||
    (typeof availableSeats === 'number' &&
      availableSeats <= 0 &&
      (plan === 'startup' || plan === 'enterprise' || plan === 'trial'))

  if (looksLikeSeatAssignment) {
    return withFallbackAction(
      {
        ...error,
        title: 'AI seat required',
        message: "You don't have an AI seat assigned in this workspace yet.",
        hint: 'Ask a billing admin to assign you a seat in Settings > Billing.',
      },
      { label: 'Open Billing', href: '/settings/billing' }
    )
  }

  if (looksLikeSeatsExhausted) {
    return withFallbackAction(
      {
        ...error,
        title: 'All AI seats are in use',
        message: 'Every paid AI seat in this workspace is currently assigned.',
        hint: 'Ask a billing admin to add seats or reassign one in Settings > Billing.',
      },
      { label: 'Open Billing', href: '/settings/billing' }
    )
  }

  if (rawMessage.includes('past due')) {
    return withFallbackAction(
      {
        ...error,
        title: 'Billing payment needed',
        message: 'AI is paused because billing for this workspace is past due.',
        hint: 'Update payment details in Settings > Billing, then retry.',
      },
      { label: 'Open Billing', href: '/settings/billing' }
    )
  }

  if (rawMessage.includes('canceled')) {
    return withFallbackAction(
      {
        ...error,
        title: 'Subscription is canceled',
        message: 'AI is unavailable because this workspace subscription is canceled.',
        hint: 'Start or renew the plan in Settings > Billing.',
      },
      { label: 'Open Billing', href: '/settings/billing' }
    )
  }

  if (rawMessage.includes('could not verify')) {
    return withFallbackAction(
      {
        ...error,
        title: 'AI access could not be verified',
        message: "We couldn't verify AI access for this workspace right now.",
        hint: 'Try again in a moment, or open Settings > Billing to check plan status.',
      },
      { label: 'Open Billing', href: '/settings/billing' }
    )
  }

  return withFallbackAction(
    {
      ...error,
      title: 'AI access requires a paid plan',
      message: "Your current workspace plan doesn't include AI access.",
      hint: 'Open Settings > Billing to start or renew a plan.',
    },
    { label: 'Open Billing', href: '/settings/billing' }
  )
}

function normalizeBillingError(raw: BillingErrorData): BillingErrorData {
  const code = resolveBillingCode(raw.error, raw.code)
  const normalized: BillingErrorData = {
    ...raw,
    error: resolveBillingErrorName(raw.error, code),
    code,
  }

  switch (code) {
    case 'ENTITLEMENT_REQUIRED':
      return normalizeEntitlementCopy(normalized)
    case 'PROVIDER_AUTH_REQUIRED':
      return withFallbackAction(
        {
          ...normalized,
          title: normalized.title || 'Connect your AI provider',
          message:
            normalized.message ||
            'Your selected AI provider is not connected on this device.',
          hint:
            normalized.hint ||
            'Open Settings > AI to connect your provider account, then retry.',
        },
        { label: 'Open AI Settings', href: '/settings/ai' }
      )
    case 'MODEL_CONFIGURATION_REQUIRED':
      return withFallbackAction(
        {
          ...normalized,
          title: normalized.title || 'Choose a valid model',
          message:
            normalized.message ||
            'The selected model configuration is invalid for this request.',
          hint:
            normalized.hint ||
            'Pick a provider-specific model in Settings > AI, then retry.',
        },
        { label: 'Open AI Settings', href: '/settings/ai' }
      )
    case 'WALLET_INSUFFICIENT_FUNDS':
      return withFallbackAction(
        {
          ...normalized,
          title: normalized.title || 'AI wallet funds needed',
          message:
            normalized.message ||
            'Your available AI wallet is out of funds for managed providers.',
          hint:
            normalized.hint ||
            'Open Settings > Billing to review included funds, or connect your own provider in Settings > AI.',
        },
        { label: 'Open Billing', href: '/settings/billing' }
      )
    default:
      return normalized
  }
}

function parseBillingErrorRecord(record: Record<string, unknown>): BillingErrorData | null {
  const error = asNonEmptyString(record.error)
  const code = asNonEmptyString(record.code)
  const resolvedCode = resolveBillingCode(error, code)

  if (!resolvedCode) return null

  return normalizeBillingError({
    error: resolveBillingErrorName(error, resolvedCode),
    code: resolvedCode,
    title: asNonEmptyString(record.title),
    message: asNonEmptyString(record.message),
    action: parseAction(record.action),
    secondaryAction: parseAction(record.secondaryAction),
    hint: asNonEmptyString(record.hint),
    details: parseDetails(record.details),
  })
}

export function parseBillingError(err: unknown): BillingErrorData | null {
  if (!err) return null

  if (isRecord(err) && !(err instanceof Error)) {
    const parsedRecord = parseBillingErrorRecord(err)
    if (parsedRecord) return parsedRecord
  }

  const rawMessage = extractErrorMessage(err)
  if (rawMessage) {
    const fromJson = parseJsonRecordFromText(rawMessage)
    if (fromJson) {
      const parsedRecord = parseBillingErrorRecord(fromJson)
      if (parsedRecord) return parsedRecord
    }

    const message = rawMessage.toLowerCase()
    if (message.includes('provider_auth_required') || message.includes('provider account required')) {
      return normalizeBillingError({
        error: 'provider_auth_required',
        code: 'PROVIDER_AUTH_REQUIRED',
        message: rawMessage,
      })
    }
    if (
      message.includes('invalid_model_id') ||
      message.includes('provider_model_mismatch') ||
      message.includes('provider_auth_provider_mismatch') ||
      message.includes('scoped_model_required')
    ) {
      return normalizeBillingError({
        error: 'invalid_model_id',
        code: 'MODEL_CONFIGURATION_REQUIRED',
        message: rawMessage,
      })
    }
    if (message.includes('entitlement_required') || message.includes('entitlement') || message.includes('plan limit')) {
      return normalizeBillingError({
        error: 'entitlement_required',
        code: 'ENTITLEMENT_REQUIRED',
        message: rawMessage,
      })
    }
    if (message.includes('wallet_insufficient_funds') || message.includes('insufficient ai wallet')) {
      return normalizeBillingError({
        error: 'wallet_insufficient_funds',
        code: 'WALLET_INSUFFICIENT_FUNDS',
        message: rawMessage,
      })
    }
    if (message.includes('subscription_required') || message.includes('subscription required')) {
      return normalizeBillingError({
        error: 'subscription_required',
        code: 'SUBSCRIPTION_REQUIRED',
        message: rawMessage,
      })
    }
  }

  return null
}

export function isBillingError(err: unknown): boolean {
  return parseBillingError(err) !== null
}
