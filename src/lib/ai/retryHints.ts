export interface RetryHint {
  retryable: boolean
  code: 'duplicate_response_item_id' | 'provider_usage_limit' | 'provider_rate_limit' | 'provider_error'
  provider?: 'openai' | 'google' | 'unknown'
  retryAfterSeconds?: number
  resetAt?: number
  shouldResetContinuation?: boolean
}

export interface AutoRetryDelayInput {
  attempt: number
  hint: RetryHint
  initialDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function readLatestRetryHint(
  messages: Array<{ parts: Array<{ type: string } & Record<string, unknown>> }>
): RetryHint | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part.type !== 'data-retry-hint') continue
      const data = part.data
      if (!isRecord(data)) continue
      if (typeof data.retryable !== 'boolean') continue
      if (typeof data.code !== 'string') continue

      return {
        retryable: data.retryable,
        code: data.code as RetryHint['code'],
        provider:
          data.provider === 'openai' || data.provider === 'google' || data.provider === 'unknown'
            ? data.provider
            : undefined,
        retryAfterSeconds:
          typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined,
        resetAt: typeof data.resetAt === 'number' ? data.resetAt : undefined,
        shouldResetContinuation:
          typeof data.shouldResetContinuation === 'boolean' ? data.shouldResetContinuation : undefined,
      }
    }
  }

  return null
}

export function shouldAutoRetryFromHint(hint: RetryHint | null): hint is RetryHint {
  if (!hint) return false
  if (!hint.retryable) return false
  if (hint.code === 'provider_usage_limit') return false
  return true
}

export function resolveAutoRetryDelayMs({
  attempt,
  hint,
  initialDelayMs = 2000,
  maxDelayMs = 30000,
  backoffFactor = 2,
}: AutoRetryDelayInput): number {
  const boundedAttempt = Math.max(1, Math.floor(attempt))
  const boundedInitial = Math.max(250, Math.floor(initialDelayMs))
  const boundedMax = Math.max(boundedInitial, Math.floor(maxDelayMs))
  const boundedBackoff = Math.max(1, backoffFactor)

  if (typeof hint.retryAfterSeconds === 'number' && hint.retryAfterSeconds > 0) {
    const hintedDelay = Math.ceil(hint.retryAfterSeconds * 1000)
    return Math.max(250, Math.min(hintedDelay, boundedMax))
  }

  const exponentialDelay = Math.round(
    boundedInitial * Math.pow(boundedBackoff, boundedAttempt - 1)
  )
  return Math.max(250, Math.min(exponentialDelay, boundedMax))
}

export function getRetryHintMessage(hint: RetryHint | null): string | null {
  if (!hint) return null

  if (hint.code === 'duplicate_response_item_id') {
    return 'Provider rejected duplicated response item IDs. Please retry once.'
  }

  if (hint.code === 'provider_usage_limit') {
    if (typeof hint.resetAt === 'number') {
      return `Provider usage limit reached. Try again after ${new Date(hint.resetAt).toLocaleTimeString()}.`
    }
    return 'Provider usage limit reached. Try again later.'
  }

  if (hint.code === 'provider_rate_limit') {
    if (typeof hint.retryAfterSeconds === 'number' && hint.retryAfterSeconds > 0) {
      return `Provider is rate-limiting requests. Retry in about ${Math.ceil(hint.retryAfterSeconds)} seconds.`
    }
    return 'Provider is rate-limiting requests. Retry shortly.'
  }

  if (hint.code === 'provider_error') {
    return hint.retryable
      ? 'Provider request failed. Retry to continue.'
      : 'Provider request failed and is not retryable right now.'
  }

  return null
}
