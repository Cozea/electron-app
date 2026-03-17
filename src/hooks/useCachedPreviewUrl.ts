import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  getCachedPreviewUrl,
  fetchAndCachePreviewUrl,
  invalidatePreviewImageCache,
} from '@/lib/previewImageCache'

export interface UseCachedPreviewUrlOptions {
  /** When false, skips the Convex query and fetch (e.g. for lazy loading). Default true. */
  enabled?: boolean
}

/**
 * Returns the project preview image URL, using an in-memory cache so the image
 * doesn't re-load from the network every time the project list is shown.
 * Call invalidatePreviewImageCache(projectId) after uploading a new preview.
 */
export function useCachedPreviewUrl(
  projectId: Id<'projects'> | undefined,
  userId?: Id<'users'>,
  options?: UseCachedPreviewUrlOptions
): {
  url: string | null
  isLoading: boolean
  error: boolean
} {
  const enabled = options?.enabled !== false
  const sourceUrl = useQuery(
    api.projects.getPreviewImageUrl,
    projectId && userId && enabled ? { projectId, userId } : 'skip'
  )
  // Track which projectId the current blobUrl belongs to so we never show another project's screenshot
  const [state, setState] = useState<{ blobUrl: string | null; forProjectId: string | null }>(() => ({
    blobUrl: projectId ? getCachedPreviewUrl(projectId) ?? null : null,
    forProjectId: projectId ?? null,
  }))
  const [error, setError] = useState(false)
  const fetchingRef = useRef<string | null>(null)

  const [prevDeps, setPrevDeps] = useState({ projectId, sourceUrl })
  if (projectId !== prevDeps.projectId || sourceUrl !== prevDeps.sourceUrl) {
    setPrevDeps({ projectId, sourceUrl })
    
    if (!projectId) {
      setState({ blobUrl: null, forProjectId: null })
      setError(false)
    } else if (sourceUrl === undefined) {
      const cached = getCachedPreviewUrl(projectId)
      setState({ blobUrl: cached ?? null, forProjectId: projectId })
      setError(false)
    } else if (sourceUrl === null) {
      invalidatePreviewImageCache(projectId)
      setState({ blobUrl: null, forProjectId: projectId })
      setError(false)
    } else {
      const cached = getCachedPreviewUrl(projectId)
      if (cached) {
        setState({ blobUrl: cached, forProjectId: projectId })
        setError(false)
      }
    }
  }

  useEffect(() => {
    if (!projectId || sourceUrl === undefined || sourceUrl === null) {
      return
    }

    const cached = getCachedPreviewUrl(projectId)
    if (cached) {
      return
    }

    // Fetch and cache (avoid duplicate in-flight fetches)
    if (fetchingRef.current === projectId) return
    fetchingRef.current = projectId
    setError(false)

    fetchAndCachePreviewUrl(projectId, sourceUrl)
      .then((url) => {
        if (fetchingRef.current === projectId) {
          setState({ blobUrl: url, forProjectId: projectId })
        }
      })
      .catch(() => {
        if (fetchingRef.current === projectId) {
          setError(true)
          setState({ blobUrl: null, forProjectId: projectId })
        }
      })
      .finally(() => {
        fetchingRef.current = null
      })
  }, [projectId, sourceUrl])

  // Only use blobUrl if it belongs to the current project (avoids showing another project's screenshot)
  const url =
    state.forProjectId === projectId ? state.blobUrl ?? null : null
  const isLoading =
    sourceUrl !== undefined && sourceUrl !== null && url === null && !error

  return {
    url,
    isLoading,
    error,
  }
}

export { invalidatePreviewImageCache } from '@/lib/previewImageCache'
