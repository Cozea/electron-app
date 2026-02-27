export interface RetryHint {
  retryable: boolean
  code: 'duplicate_response_item_id' | 'provider_usage_limit' | 'provider_rate_limit' | 'provider_error'
  provider?: 'openai' | 'google' | 'unknown'
  retryAfterSeconds?: number
  resetAt?: number
  shouldResetContinuation?: boolean
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
