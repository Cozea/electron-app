import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchWithAbortMock } = vi.hoisted(() => ({
  fetchWithAbortMock: vi.fn(),
}))

vi.mock('../src/lib/abort', () => ({
  fetchWithAbort: fetchWithAbortMock,
}))

vi.mock('@shared/aiProviderAvailability', () => ({
  isProviderEnabledInApp: () => true,
}))

vi.mock('../src/lib/ai/providerAuth', () => ({
  isManagedProvider: (provider: string) => provider === 'google',
}))

import { clearModelCatalogCache, getModelCatalog } from '../src/lib/ai/modelCatalogClient'

describe('getModelCatalog', () => {
  beforeEach(() => {
    clearModelCatalogCache()
    fetchWithAbortMock.mockReset()
  })

  it('merges managed and secondary provider catalogs instead of dropping the secondary set', async () => {
    fetchWithAbortMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('providers=google')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                id: 'google/gemini-3.1-pro',
                provider: 'google',
                displayName: 'Gemini 3.1 Pro',
                tier: 'paid',
              },
            ],
          }),
        }
      }

      if (url.includes('providers=anthropic%2Cgoogle') || url.includes('providers=google%2Canthropic')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                id: 'google/gemini-3.1-pro',
                provider: 'google',
                displayName: 'Gemini 3.1 Pro',
                tier: 'paid',
              },
            ],
          }),
        }
      }

      if (url.includes('providers=anthropic')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                id: 'anthropic/claude-sonnet-4-5',
                provider: 'anthropic',
                displayName: 'Claude Sonnet 4.5',
                tier: 'paid',
              },
            ],
          }),
        }
      }

      throw new Error(`Unexpected catalog URL: ${url}`)
    })

    const catalog = await getModelCatalog({
      organizationId: 'org_123',
      accessToken: 'token_123',
      connectedProviders: ['google', 'anthropic'],
    })

    expect(fetchWithAbortMock).toHaveBeenCalledTimes(2)
    expect(catalog.models.map((model) => model.id)).toEqual([
      'google/gemini-3.1-pro',
      'anthropic/claude-sonnet-4-5',
    ])
  })
})
