import type { ModelApiModel } from './modelCatalogClient'

function inferScopedProvider(modelId: string): string | undefined {
  if (modelId.includes('gpt-')) return 'openai'
  if (modelId.includes('claude-')) return 'anthropic'
  if (modelId.includes('gemini-')) return 'google'
  if (modelId.includes('grok-')) return 'xai'
  if (modelId.includes('copilot-')) return 'github-copilot'
  return undefined
}

export function normalizeStoredModelId(model: string | undefined): string | undefined {
  if (typeof model !== 'string') return undefined

  const trimmed = model.trim()
  if (!trimmed) return undefined
  if (trimmed.includes('/')) return trimmed

  const provider = inferScopedProvider(trimmed)
  return provider ? `${provider}/${trimmed}` : trimmed
}

function parseRequestedModelId(modelId: string): {
  provider?: string
  providerModelId: string
} | null {
  const trimmed = modelId.trim()
  if (!trimmed) return null

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
    return {
      provider: trimmed.slice(0, slashIndex).trim().toLowerCase(),
      providerModelId: trimmed.slice(slashIndex + 1).trim(),
    }
  }

  return {
    provider: inferScopedProvider(trimmed),
    providerModelId: trimmed,
  }
}

function getCatalogProviderModelId(model: Pick<ModelApiModel, 'id' | 'providerModelId'>): string {
  const explicitProviderModelId =
    typeof model.providerModelId === 'string' ? model.providerModelId.trim() : ''
  if (explicitProviderModelId) {
    return explicitProviderModelId
  }

  const scopedId = model.id.trim()
  const slashIndex = scopedId.indexOf('/')
  return slashIndex > 0 && slashIndex < scopedId.length - 1
    ? scopedId.slice(slashIndex + 1).trim()
    : scopedId
}

export function resolveModelIdFromCatalog(
  requestedModelId: string | undefined,
  models: Array<Pick<ModelApiModel, 'id' | 'provider' | 'providerModelId'>>
): string | undefined {
  const normalizedRequested = normalizeStoredModelId(requestedModelId)
  if (!normalizedRequested) return undefined

  const exactMatch = models.find((model) => model.id.trim() === normalizedRequested)
  if (exactMatch) {
    return exactMatch.id
  }

  const requested = parseRequestedModelId(normalizedRequested)
  if (!requested || !requested.provider) {
    return undefined
  }

  const providerModelMatch = models.find((model) => (
    model.provider.trim().toLowerCase() === requested.provider &&
    getCatalogProviderModelId(model) === requested.providerModelId
  ))

  return providerModelMatch?.id
}
