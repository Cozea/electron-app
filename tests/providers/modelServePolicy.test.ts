import { describe, expect, it } from 'vitest'

import { isModelServableByPolicy } from '../../server/src/routes/ai/modelServePolicy'

describe('model serve policy', () => {
  it('filters Google models older than the Gemini 3 series', () => {
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-1.5-pro' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-2.0-flash' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-2.5-pro' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-2.5-flash' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-3-pro-preview' })).toBe(true)
    expect(isModelServableByPolicy({ providerId: 'google', modelId: 'gemini-flash-latest' })).toBe(false)
  })

  it('filters OpenAI models older than GPT-5', () => {
    expect(isModelServableByPolicy({ providerId: 'openai', modelId: 'gpt-4.1' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'openai', modelId: 'o3' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'openai', modelId: 'gpt-5' })).toBe(true)
    expect(isModelServableByPolicy({ providerId: 'openai', modelId: 'gpt-5.1-codex' })).toBe(true)
  })

  it('filters Anthropic models older than the Claude 3.7 series', () => {
    expect(isModelServableByPolicy({ providerId: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'anthropic', modelId: 'claude-3-sonnet-20240229' })).toBe(false)
    expect(isModelServableByPolicy({ providerId: 'anthropic', modelId: 'claude-3-7-sonnet-20250219' })).toBe(true)
    expect(isModelServableByPolicy({ providerId: 'anthropic', modelId: 'claude-sonnet-4-0' })).toBe(true)
    expect(isModelServableByPolicy({ providerId: 'anthropic', modelId: 'claude-haiku-4-5' })).toBe(true)
  })

  it('does not affect other providers', () => {
    expect(isModelServableByPolicy({ providerId: 'xai', modelId: 'grok-4-fast' })).toBe(true)
    expect(isModelServableByPolicy({ providerId: 'github-copilot', modelId: 'gpt-4.1' })).toBe(true)
  })
})
