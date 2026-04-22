import { describe, expect, it } from 'vitest'

import { analyzeStreamError } from '../../server/src/routes/ai/runtime/streamError'

function createApiError(
  message: string,
  extras: Record<string, unknown>
): Error & Record<string, unknown> {
  return Object.assign(new Error(message), extras)
}

describe('stream error analysis', () => {
  it('classifies OpenAI quota errors and normalizes resetAt to milliseconds', () => {
    const result = analyzeStreamError(
      createApiError('OpenAI quota', {
        statusCode: 429,
        data: {
          error: {
            type: 'insufficient_quota',
            resets_at: 1_700_000_000,
          },
        },
      }),
      { providerHint: 'openai' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_usage_limit',
      provider: 'openai',
      resetAt: 1_700_000_000_000,
    })
  })

  it('classifies OpenAI rate limits separately from quota errors', () => {
    const result = analyzeStreamError(
      createApiError('OpenAI rate limit', {
        statusCode: 429,
      }),
      { providerHint: 'openai' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_rate_limit',
      provider: 'openai',
      retryable: true,
    })
  })

  it('classifies Gemini daily quota exhaustion', () => {
    const result = analyzeStreamError(
      createApiError('Gemini quota', {
        statusCode: 429,
        data: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaMetric: 'GenerateRequestsPerModelPerDay',
                    quotaId: 'GenerateRequestsPerModelPerDay',
                    quotaValue: '100',
                    quotaDimensions: {
                      model: 'gemini-2.5-pro',
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
      { providerHint: 'google' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_usage_limit',
      provider: 'google',
      retryable: false,
      title: 'Gemini daily quota reached',
      message: 'Requests for gemini-2.5-pro are exhausted for today.',
    })
  })

  it('classifies Gemini temporary rate limits', () => {
    const result = analyzeStreamError(
      createApiError('Gemini rate limit', {
        statusCode: 429,
        data: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: 'Retry in 30s',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaMetric: 'GenerateRequestsPerMinute',
                    quotaId: 'GenerateRequestsPerMinute',
                    quotaDimensions: {
                      model: 'gemini-2.5-flash',
                    },
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '30s',
              },
            ],
          },
        },
      }),
      { providerHint: 'google' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_rate_limit',
      provider: 'google',
      retryable: true,
      retryAfterSeconds: 30,
      title: 'Gemini rate limit reached',
      message: 'Google is temporarily rate-limiting requests for gemini-2.5-flash.',
    })
  })

  it('classifies Anthropic 429 rate limit errors', () => {
    const result = analyzeStreamError(
      createApiError('Anthropic rate limit', {
        statusCode: 429,
        data: {
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded',
          },
        },
      }),
      { providerHint: 'anthropic' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_rate_limit',
      provider: 'anthropic',
      retryable: true,
      title: 'Anthropic rate limit reached',
      message: 'Anthropic is temporarily rate-limiting requests.',
    })
  })

  it('classifies Anthropic 529 overloaded errors as structured provider errors', () => {
    const result = analyzeStreamError(
      createApiError('Anthropic overloaded', {
        statusCode: 529,
        data: {
          error: {
            type: 'overloaded_error',
            message: 'Overloaded',
          },
        },
      }),
      { providerHint: 'anthropic' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_error',
      provider: 'anthropic',
      retryable: true,
      title: 'Anthropic overloaded',
      message: 'Anthropic is temporarily overloaded. Retry shortly.',
    })
  })

  it('classifies xAI 429 inference errors as rate limits', () => {
    const result = analyzeStreamError(
      createApiError('xAI rate limit', {
        statusCode: 429,
        data: {
          error: {
            message: 'Too many requests',
          },
        },
      }),
      { providerHint: 'xai' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_rate_limit',
      provider: 'xai',
      retryable: true,
      title: 'xAI rate limit reached',
      message: 'xAI is temporarily rate-limiting requests.',
    })
  })

  it('keeps unsupported providers on the generic fallback path', () => {
    const result = analyzeStreamError(
      createApiError('Copilot rate limit', {
        statusCode: 429,
      }),
      { providerHint: 'github-copilot' }
    )

    expect(result.retryHint).toMatchObject({
      code: 'provider_error',
      provider: 'github-copilot',
      retryable: true,
    })
  })
})
