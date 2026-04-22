import { describe, expect, it } from 'vitest'

import { getRetryHintSurfaceError } from '../../src/lib/ai/surfaceErrors'

describe('retry hint surface errors', () => {
  it('prefers backend-supplied compact copy but drops actions for 429 cards', () => {
    const surfaceError = getRetryHintSurfaceError({
      retryable: true,
      code: 'provider_rate_limit',
      provider: 'anthropic',
      title: 'Anthropic rate limit reached',
      message: 'Anthropic is temporarily rate-limiting requests.',
      action: {
        label: 'Open AI Settings',
        href: '/settings/ai',
      },
    })

    expect(surfaceError).toEqual({
      code: 'provider_rate_limit',
      provider: 'anthropic',
      title: 'Anthropic rate limit reached',
      message: 'Anthropic is temporarily rate-limiting requests.',
      action: undefined,
      model: undefined,
    })
  })

  it('drops actions for compact quota cards too', () => {
    const surfaceError = getRetryHintSurfaceError({
      retryable: true,
      code: 'provider_usage_limit',
      provider: 'google',
      title: 'Gemini quota reached',
      message: 'Daily quota reached. Try again later.',
      action: {
        label: 'Open AI Settings',
        href: '/settings/ai',
      },
    })

    expect(surfaceError).toEqual({
      code: 'provider_usage_limit',
      provider: 'google',
      title: 'Gemini quota reached',
      message: 'Daily quota reached. Try again later.',
      action: undefined,
      model: undefined,
    })
  })

  it('renders structured provider_error cards only when compact copy is provided', () => {
    expect(
      getRetryHintSurfaceError({
        retryable: true,
        code: 'provider_error',
        provider: 'anthropic',
        title: 'Anthropic overloaded',
        message: 'Anthropic is temporarily overloaded. Retry shortly.',
      })
    ).toEqual({
      code: 'provider_error',
      provider: 'anthropic',
      title: 'Anthropic overloaded',
      message: 'Anthropic is temporarily overloaded. Retry shortly.',
      action: undefined,
      model: undefined,
    })

    expect(
      getRetryHintSurfaceError({
        retryable: true,
        code: 'provider_error',
        provider: 'anthropic',
      })
    ).toBeNull()
  })

  it('falls back to compact generated copy when the backend did not provide one', () => {
    const surfaceError = getRetryHintSurfaceError({
      retryable: true,
      code: 'provider_rate_limit',
      provider: 'xai',
      retryAfterSeconds: 15,
    })

    expect(surfaceError).toEqual({
      code: 'provider_rate_limit',
      provider: 'xai',
      title: 'xAI rate limit reached',
      message: 'Try again in about 15s or switch model.',
      action: undefined,
      model: undefined,
    })
  })
})
