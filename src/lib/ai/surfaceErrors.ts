import type { RetryHint, RetryHintAction } from '@/lib/ai/retryHints'

export interface AiSurfaceErrorData {
  code: RetryHint['code']
  title: string
  message: string
  hint?: string
  action?: RetryHintAction
  provider?: RetryHint['provider']
  model?: string
}

function formatDurationCompact(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'soon'

  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const parts: string[] = []

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 && parts.length < 2) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push(`${Math.max(1, Math.ceil(totalSeconds))}s`)

  return parts.slice(0, 2).join(' ')
}

function getProviderLabel(provider: RetryHint['provider']): string {
  if (provider === 'google') return 'Gemini'
  if (provider === 'openai') return 'OpenAI'
  return 'Provider'
}

export function getRetryHintSurfaceError(hint: RetryHint | null): AiSurfaceErrorData | null {
  if (!hint) return null
  if (hint.code !== 'provider_usage_limit' && hint.code !== 'provider_rate_limit') {
    return null
  }

  const providerLabel = getProviderLabel(hint.provider)

  if (hint.code === 'provider_usage_limit') {
    return {
      code: hint.code,
      title:
        providerLabel === 'Gemini'
          ? 'Gemini quota reached'
          : `${providerLabel} quota reached`,
      message:
        typeof hint.retryAfterSeconds === 'number' && hint.retryAfterSeconds > 0
          ? `Try again in about ${formatDurationCompact(hint.retryAfterSeconds)} or switch model.`
          : 'Try again later or switch model.',
      provider: hint.provider,
      model: hint.model,
    }
  }

  return {
    code: hint.code,
    title:
      providerLabel === 'Gemini'
        ? 'Gemini rate limit reached'
        : `${providerLabel} rate limit reached`,
    message:
      typeof hint.retryAfterSeconds === 'number' && hint.retryAfterSeconds > 0
        ? `Try again in about ${formatDurationCompact(hint.retryAfterSeconds)} or switch model.`
        : 'Try again shortly or switch model.',
    provider: hint.provider,
    model: hint.model,
  }
}
