import type { RetryHint, RetryHintAction } from '@/lib/ai/retryHints'

export interface AiSurfaceErrorData {
  code: RetryHint['code']
  title: string
  message: string
  action?: RetryHintAction
  provider?: RetryHint['provider']
  model?: string
}

function getSurfaceAction(hint: RetryHint): RetryHintAction | undefined {
  // Keep 429 surfaces terse; settings CTAs take too much space for this compact card.
  if (
    hint.code === 'provider_rate_limit' ||
    hint.code === 'provider_usage_limit'
  ) {
    return undefined
  }
  return hint.action
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
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'xai') return 'xAI'
  if (provider === 'github-copilot') return 'GitHub Copilot'
  if (provider === 'gitlab') return 'GitLab'
  if (typeof provider === 'string' && provider.trim().length > 0) {
    return provider
      .split(/[-_]/g)
      .filter((part) => part.length > 0)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ')
  }
  return 'Provider'
}

export function getRetryHintSurfaceError(hint: RetryHint | null): AiSurfaceErrorData | null {
  if (!hint) return null
  if (
    hint.code !== 'provider_usage_limit' &&
    hint.code !== 'provider_rate_limit' &&
    hint.code !== 'provider_error'
  ) {
    return null
  }

  if (hint.title && hint.message) {
    return {
      code: hint.code,
      title: hint.title,
      message: hint.message,
      action: getSurfaceAction(hint),
      provider: hint.provider,
      model: hint.model,
    }
  }

  if (hint.code === 'provider_error') {
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
      action: getSurfaceAction(hint),
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
    action: getSurfaceAction(hint),
    provider: hint.provider,
    model: hint.model,
  }
}
