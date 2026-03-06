import { fetchWithAbort } from '@/lib/abort'
import { isProviderEnabledInApp } from '@shared/aiProviderAvailability'

import { AI_BASE_URL } from './apiEndpoints'
import { isManagedProvider } from './providerAuth'
import type { RuntimeModelCapabilities } from './runtimeProfiles'

export interface ModelApiModel {
  id: string
  displayName: string
  provider: string
  tier: string
  limit?: { context?: number; output?: number }
  capabilities?: RuntimeModelCapabilities
}

export interface ModelApiResponse {
  models: ModelApiModel[]
}

interface ModelCatalogCacheEntry {
  data?: ModelApiResponse
  promise?: Promise<ModelApiResponse>
}

const modelCatalogCache = new Map<string, ModelCatalogCacheEntry>()

function normalizeProviderFilter(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry) => entry.length > 0)

  return Array.from(new Set(normalized)).sort()
}

function cacheKey(organizationId: string, providerSegment: string): string {
  return `${organizationId.trim()}::${providerSegment}`
}

function sortModelsManagedFirst(models: ModelApiModel[]): ModelApiModel[] {
  return [...models].sort((a, b) => {
    const aManaged = isManagedProvider(a.provider)
    const bManaged = isManagedProvider(b.provider)
    if (aManaged && !bManaged) return -1
    if (!aManaged && bManaged) return 1
    return a.id.localeCompare(b.id)
  })
}

export function clearModelCatalogCache(organizationId?: string): void {
  if (!organizationId) {
    modelCatalogCache.clear()
    return
  }

  const prefix = `${organizationId.trim()}::`
  for (const key of modelCatalogCache.keys()) {
    if (key.startsWith(prefix)) {
      modelCatalogCache.delete(key)
    }
  }
}

export function getCachedModelContextWindow(modelId: string): number | undefined {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) return undefined

  for (const entry of modelCatalogCache.values()) {
    if (!entry.data?.models?.length) continue
    const model = entry.data.models.find((candidate) => candidate.id === normalizedModelId)
    const contextLimit = model?.limit?.context
    if (typeof contextLimit === 'number' && Number.isFinite(contextLimit) && contextLimit > 0) {
      return Math.floor(contextLimit)
    }
  }

  return undefined
}

export async function getModelCatalog(args: {
  organizationId: string
  accessToken: string
  connectedProviders?: string[]
  forceRefresh?: boolean
}): Promise<ModelApiResponse> {
  const hasProviderFilter = Array.isArray(args.connectedProviders)
  const providerFilter = normalizeProviderFilter(args.connectedProviders).filter((providerId) =>
    isProviderEnabledInApp(providerId)
  )
  const managedProviders = hasProviderFilter
    ? providerFilter.filter((providerId) => isManagedProvider(providerId))
    : []
  const primaryProviderFilter =
    hasProviderFilter && managedProviders.length > 0 ? managedProviders : providerFilter
  const hasSecondaryProviderFilter =
    hasProviderFilter && managedProviders.length > 0 && managedProviders.length < providerFilter.length
  const secondaryProviderFilter = hasSecondaryProviderFilter ? providerFilter : null

  if (hasProviderFilter && providerFilter.length === 0) {
    return { models: [] }
  }

  const providerSegment = hasProviderFilter
    ? `${primaryProviderFilter.join(',')}::${secondaryProviderFilter ? secondaryProviderFilter.join(',') : ''}`
    : '*'
  const key = cacheKey(args.organizationId, providerSegment)
  const forceRefresh = Boolean(args.forceRefresh)
  const cached = modelCatalogCache.get(key)

  if (!forceRefresh && cached?.data) {
    return cached.data
  }

  if (!forceRefresh && cached?.promise) {
    return cached.promise
  }

  let isTransientAuthError = false

  const requestCatalog = async (providers: string[] | null): Promise<ModelApiResponse> => {
    const query = new URLSearchParams({
      organizationId: args.organizationId,
    })
    if (providers && providers.length > 0) {
      query.set('providers', providers.join(','))
    }

    const response = await fetchWithAbort(
      `${AI_BASE_URL}/models?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
        },
      },
      { timeoutMs: 15_000 }
    )

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        isTransientAuthError = true
        throw new Error('Unauthorized. Please sign in again.')
      }
      throw new Error('Failed to load models')
    }

    return (await response.json()) as ModelApiResponse
  }

  const nextPromise = requestCatalog(hasProviderFilter ? primaryProviderFilter : null)
    .then(async (primaryData) => {
      if (
        secondaryProviderFilter &&
        Array.isArray(primaryData.models) &&
        primaryData.models.length === 0
      ) {
        return await requestCatalog(secondaryProviderFilter)
      }
      return primaryData
    })
    .then((data) => {
      const normalizedData = {
        models: sortModelsManagedFirst(
          (Array.isArray(data.models) ? data.models : []).filter((model) =>
            isProviderEnabledInApp(model.provider)
          )
        ),
      }
      modelCatalogCache.set(key, { data: normalizedData })
      return normalizedData
    })
    .catch((error) => {
      modelCatalogCache.delete(key)
      if (isTransientAuthError && !forceRefresh) {
        console.warn('[ModelCatalog] 401 unauthorized. Token may be expiring. Will retry once in 1.5s.')
        return new Promise<ModelApiResponse>((resolve, reject) => {
          setTimeout(() => {
            getModelCatalog({ ...args, forceRefresh: true }).then(resolve).catch(reject)
          }, 1500)
        })
      }
      throw error
    })

  modelCatalogCache.set(key, { ...cached, promise: nextPromise })
  return nextPromise
}
