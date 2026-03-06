import { describe, expect, it } from 'vitest'

import type { ModelCapabilities } from '../server/src/routes/ai/modelCatalog'
import { inferGoogleReasoningCapabilities } from '../server/src/routes/ai/googleReasoningCapabilities'
import { buildProviderOptions } from '../server/src/routes/ai/providerHelpers'

function createGoogleCapabilities(
  overrides: Partial<ModelCapabilities> = {}
): ModelCapabilities {
  return {
    supportsExtendedThinking: true,
    reasoningType: 'level',
    reasoningRange: ['low', 'high'],
    supportsWebSearch: true,
    supportsFileSearch: true,
    supportsCodeInterpreter: true,
    supportsComputerUse: false,
    supportsShellTool: false,
    supportsTextEditor: false,
    supportsApplyPatch: false,
    supportsEffortParameter: false,
    supportsUrlContext: true,
    supportsMapsGrounding: true,
    supportsPdfInput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsPredictedOutput: false,
    promptCachingType: 'automatic',
    ...overrides,
  }
}

describe('google reasoning capabilities', () => {
  it('maps Gemini 2.5 Pro from models.dev shape to budget reasoning', () => {
    expect(inferGoogleReasoningCapabilities('gemini-2.5-pro', true)).toEqual({
      reasoningType: 'budget',
      reasoningRange: { min: 128, max: 32768 },
    })
  })

  it('treats older Gemini 2.5 Pro previews as non-configurable thinking models', () => {
    expect(inferGoogleReasoningCapabilities('gemini-2.5-pro-preview-05-06', true)).toEqual({
      reasoningType: 'none',
      reasoningRange: undefined,
    })
  })

  it('maps Gemini 3 Pro to thinking levels', () => {
    expect(inferGoogleReasoningCapabilities('google/gemini-3-pro-preview', true)).toEqual({
      reasoningType: 'level',
      reasoningRange: ['low', 'high'],
    })
  })

  it('maps Gemini 3 Flash to the full supported level set', () => {
    expect(inferGoogleReasoningCapabilities('gemini-3-flash-preview', true)).toEqual({
      reasoningType: 'level',
      reasoningRange: ['minimal', 'low', 'medium', 'high'],
    })
  })

  it('builds thinkingBudget for Gemini 2.5 even if cached capabilities are stale', () => {
    const options = buildProviderOptions(
      'google',
      'gemini-2.5-pro',
      createGoogleCapabilities({
        reasoningType: 'level',
        reasoningRange: ['low', 'high'],
      }),
      undefined,
      'high'
    )

    expect(options).toEqual({
      google: {
        thinkingConfig: {
          thinkingBudget: 16000,
          includeThoughts: true,
        },
      },
    })
  })

  it('builds thinkingLevel for Gemini 3 even if cached capabilities are stale', () => {
    const options = buildProviderOptions(
      'google',
      'gemini-3-flash-preview',
      createGoogleCapabilities({
        reasoningType: 'budget',
        reasoningRange: { min: 0, max: 24576 },
      }),
      undefined,
      'medium'
    )

    expect(options).toEqual({
      google: {
        thinkingConfig: {
          thinkingLevel: 'medium',
          includeThoughts: true,
        },
      },
    })
  })

  it('clamps explicit Gemini 2.5 budgets to the supported range', () => {
    const options = buildProviderOptions(
      'google',
      'gemini-2.5-pro',
      createGoogleCapabilities(),
      {
        thinkingBudgetTokens: 999_999,
      }
    )

    expect(options).toEqual({
      google: {
        thinkingConfig: {
          thinkingBudget: 32768,
          includeThoughts: true,
        },
      },
    })
  })

  it('omits thinkingConfig for legacy Gemini 2.5 Pro previews', () => {
    const options = buildProviderOptions(
      'google',
      'gemini-2.5-pro-preview-05-06',
      createGoogleCapabilities({
        reasoningType: 'budget',
        reasoningRange: { min: 128, max: 32768 },
      })
    )

    expect(options).toBeUndefined()
  })
})
