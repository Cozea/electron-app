export interface RetryHint {
  retryable: boolean
  code: string
  provider?: string
  resetAt?: number
}

function normalizeRetryHint(value: unknown): RetryHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const code = typeof candidate.code === 'string' ? candidate.code : null
  if (!code) {
    return null
  }

  return {
    retryable: candidate.retryable !== false,
    code,
    provider: typeof candidate.provider === 'string' ? candidate.provider : undefined,
    resetAt:
      typeof candidate.resetAt === 'number' && Number.isFinite(candidate.resetAt)
        ? candidate.resetAt
        : undefined,
  }
}

export function readLatestRetryHint(messages: unknown[]): RetryHint | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      continue
    }

    const candidate = message as Record<string, unknown>
    const parts = Array.isArray(candidate.parts) ? candidate.parts : []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        continue
      }
      const partCandidate = part as Record<string, unknown>
      if (partCandidate.type !== 'data-retry-hint') {
        continue
      }

      const normalized = normalizeRetryHint(partCandidate.data)
      if (normalized) {
        return normalized
      }
    }
  }

  return null
}

export function getRetryHintMessage(hint: RetryHint): string {
  if (hint.code === 'provider_usage_limit') {
    if (hint.resetAt) {
      return `Provider usage limit reached. Try again after ${new Date(hint.resetAt).toLocaleTimeString()}.`
    }
    return 'Provider usage limit reached. Try again later.'
  }

  if (hint.code === 'provider_rate_limit') {
    return 'Provider rate limit reached. Try again shortly.'
  }

  if (hint.code === 'provider_auth_required') {
    return 'Provider authentication is required before retrying.'
  }

  return 'This request can be retried.'
}
