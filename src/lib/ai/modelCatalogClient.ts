import { fetchWithAbort } from '@/lib/abort'

import { AI_BASE_URL } from './apiEndpoints'
import type { RuntimeModelCapabilities } from './runtimeProfiles'

export interface ModelApiModel {
  id: string
  displayName: string
  provider: string
  tier: string
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

function cacheKey(organizationId: string): string {
  return organizationId.trim()
}

export function clearModelCatalogCache(organizationId?: string): void {
  if (!organizationId) {
    modelCatalogCache.clear()
    return
  }

  modelCatalogCache.delete(cacheKey(organizationId))
}

export async function getModelCatalog(args: {
  organizationId: string
  accessToken: string
  forceRefresh?: boolean
}): Promise<ModelApiResponse> {
  const key = cacheKey(args.organizationId)
  const forceRefresh = Boolean(args.forceRefresh)
  const cached = modelCatalogCache.get(key)

  if (!forceRefresh && cached?.data) {
    return cached.data
  }

  if (!forceRefresh && cached?.promise) {
    return cached.promise
  }

  const nextPromise = fetchWithAbort(
    `${AI_BASE_URL}/models?organizationId=${encodeURIComponent(args.organizationId)}`,
    {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    },
    { timeoutMs: 15_000 }
  )
    .then(async (response) => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Unauthorized. Please sign in again.')
        }
        throw new Error('Failed to load models')
      }

      return (await response.json()) as ModelApiResponse
    })
    .then((data) => {
      modelCatalogCache.set(key, { data })
      return data
    })
    .catch((error) => {
      modelCatalogCache.delete(key)
      throw error
    })

  modelCatalogCache.set(key, { ...cached, promise: nextPromise })
  return nextPromise
}
