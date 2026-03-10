import { describe, expect, it } from 'vitest'

import {
  normalizeStoredModelId,
  resolveModelIdFromCatalog,
} from '../src/lib/ai/modelIdResolution'

describe('modelIdResolution', () => {
  it('scopes unscoped stored model ids without hardcoded aliases', () => {
    expect(normalizeStoredModelId('gemini-3.1-pro-preview')).toBe('google/gemini-3.1-pro-preview')
    expect(normalizeStoredModelId('gpt-5.2')).toBe('openai/gpt-5.2')
  })

  it('resolves canonical app ids using providerModelId from the catalog', () => {
    const resolved = resolveModelIdFromCatalog('google/gemini-3.1-pro-preview', [
      {
        id: 'google/gemini-3.1-pro',
        provider: 'google',
        providerModelId: 'gemini-3.1-pro-preview',
      },
    ])

    expect(resolved).toBe('google/gemini-3.1-pro')
  })

  it('keeps exact catalog ids unchanged', () => {
    const resolved = resolveModelIdFromCatalog('google/gemini-3.1-pro', [
      {
        id: 'google/gemini-3.1-pro',
        provider: 'google',
        providerModelId: 'gemini-3.1-pro-preview',
      },
    ])

    expect(resolved).toBe('google/gemini-3.1-pro')
  })
})
