import { describe, expect, it } from 'vitest'

import { getRetryHintMessage, readLatestRetryHint } from '../src/lib/ai/retryHints'

describe('retry hint parsing', () => {
  it('preserves provider ids outside the original OpenAI/Google union', () => {
    const hint = readLatestRetryHint([
      {
        parts: [
          {
            type: 'data-retry-hint',
            data: {
              retryable: true,
              code: 'provider_rate_limit',
              provider: 'anthropic',
            },
          },
        ],
      },
    ])

    expect(hint?.provider).toBe('anthropic')
  })

  it('renders resetAt values as epoch milliseconds', () => {
    const resetAt = 1_700_000_000_000

    expect(
      getRetryHintMessage({
        retryable: true,
        code: 'provider_usage_limit',
        provider: 'openai',
        resetAt,
      })
    ).toBe(`Provider usage limit reached. Try again after ${new Date(resetAt).toLocaleTimeString()}.`)
  })
})
