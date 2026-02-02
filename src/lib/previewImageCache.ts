/**
 * In-memory cache for project preview images (screenshots).
 * Fetches the Convex storage URL once, stores a blob URL, so the image
 * doesn't re-load from the network every time the project list is shown.
 */

const cache = new Map<string, { blobUrl: string }>()
const MAX_ENTRIES = 100

function evictOldest(): void {
  if (cache.size < MAX_ENTRIES) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) {
    const entry = cache.get(firstKey)
    if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl)
    cache.delete(firstKey)
  }
}

/**
 * Return a cached blob URL for the project if one exists.
 */
export function getCachedPreviewUrl(projectId: string): string | undefined {
  return cache.get(projectId)?.blobUrl
}

/**
 * Fetch the image from the Convex storage URL, create a blob URL, cache it by projectId, and return it.
 * Call invalidatePreviewImageCache(projectId) when the preview is updated so the next load uses the new image.
 */
export async function fetchAndCachePreviewUrl(
  projectId: string,
  storageUrl: string
): Promise<string> {
  const existing = cache.get(projectId)
  if (existing?.blobUrl) return existing.blobUrl

  const response = await fetch(storageUrl)
  if (!response.ok) throw new Error(`Preview fetch failed: ${response.status}`)
  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  evictOldest()
  cache.set(projectId, { blobUrl })
  return blobUrl
}

/**
 * Invalidate the cached preview for a project (e.g. after uploading a new screenshot).
 * Revokes the blob URL and removes the entry.
 */
export function invalidatePreviewImageCache(projectId: string): void {
  const entry = cache.get(projectId)
  if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl)
  cache.delete(projectId)
}
