import { captureProjectPreviewBlob } from '@/lib/captureProjectPreview'

interface RoutePreviewImageEntry {
  blobUrl: string
  capturedAt: number
}

const MAX_ENTRIES = 160

const cache = new Map<string, RoutePreviewImageEntry>()
const pendingCaptures = new Map<string, Promise<string>>()

function buildCacheKey(projectId: string, routePath: string): string {
  return `${projectId}::${routePath}`
}

function evictOldestEntry(): void {
  if (cache.size < MAX_ENTRIES) return
  const oldestKey = cache.keys().next().value
  if (!oldestKey) return
  const entry = cache.get(oldestKey)
  if (entry?.blobUrl) {
    URL.revokeObjectURL(entry.blobUrl)
  }
  cache.delete(oldestKey)
}

export function getCachedRoutePreviewUrl(projectId: string, routePath: string): string | null {
  return cache.get(buildCacheKey(projectId, routePath))?.blobUrl ?? null
}

export function invalidateRoutePreviewCache(projectId: string, routePath?: string): void {
  if (routePath) {
    const cacheKey = buildCacheKey(projectId, routePath)
    const entry = cache.get(cacheKey)
    if (entry?.blobUrl) {
      URL.revokeObjectURL(entry.blobUrl)
    }
    cache.delete(cacheKey)
    pendingCaptures.delete(cacheKey)
    return
  }

  for (const [cacheKey, entry] of cache.entries()) {
    if (!cacheKey.startsWith(`${projectId}::`)) continue
    if (entry.blobUrl) {
      URL.revokeObjectURL(entry.blobUrl)
    }
    cache.delete(cacheKey)
    pendingCaptures.delete(cacheKey)
  }
}

export async function captureAndCacheRoutePreview(
  projectId: string,
  routePath: string,
  previewUrl: string,
  options?: {
    attempts?: number
    height?: number
    width?: number
  }
): Promise<string> {
  const cacheKey = buildCacheKey(projectId, routePath)
  const existing = cache.get(cacheKey)
  if (existing?.blobUrl) {
    return existing.blobUrl
  }

  const inFlight = pendingCaptures.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  const capturePromise = (async () => {
    const blob = await captureProjectPreviewBlob(previewUrl, options)
    const blobUrl = URL.createObjectURL(blob)
    evictOldestEntry()
    cache.set(cacheKey, {
      blobUrl,
      capturedAt: Date.now(),
    })
    pendingCaptures.delete(cacheKey)
    return blobUrl
  })()

  pendingCaptures.set(cacheKey, capturePromise)

  try {
    return await capturePromise
  } catch (error) {
    pendingCaptures.delete(cacheKey)
    throw error
  }
}
