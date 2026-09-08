import { useEffect } from 'react'
import { create } from 'zustand'
import { scheduleTask } from '@/lib/scheduler'
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient'

interface QueryCacheState {
  cache: Record<string, { data: unknown; timestamp: number }>
  set: (key: string, data: unknown) => void
  get: <T>(key: string, maxAge?: number) => T | undefined
  clear: (key?: string) => void
}

const DEFAULT_MAX_AGE = 5 * 60 * 1000 // 5 minutes
const HARD_MAX_AGE = 24 * 60 * 60 * 1000 // 24 hours
const MAX_CACHE_ENTRIES = 250
const MIN_CACHE_REFRESH_INTERVAL_MS = 750

function pruneCache(
  cache: Record<string, { data: unknown; timestamp: number }>
): Record<string, { data: unknown; timestamp: number }> {
  const now = Date.now()
  const entries = Object.entries(cache).filter(([, entry]) => {
    return Number.isFinite(entry.timestamp) && now - entry.timestamp <= HARD_MAX_AGE
  })

  if (entries.length <= MAX_CACHE_ENTRIES) {
    return Object.fromEntries(entries)
  }

  entries.sort((a, b) => b[1].timestamp - a[1].timestamp)
  return Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES))
}

/**
 * Granular query cache for Convex data (Section 10.1, 10.3).
 * In-memory store backed by desktopPersistenceClient dirty-entry queue;
 * avoids whole-store serialization on every query update (F05).
 */
export const useQueryCache = create<QueryCacheState>()((set, get) => ({
  cache: {},

  set: (key: string, data: unknown) => {
    const existing = get().cache[key]
    if (existing && existing.data === data) {
      return
    }

    const now = Date.now()
    const previous = get().cache
    const next = pruneCache({
      ...previous,
      [key]: { data, timestamp: now },
    })
    set({ cache: next })
    for (const previousKey of Object.keys(previous)) {
      if (!(previousKey in next)) desktopPersistenceClient.deleteRecord('queryCache', previousKey)
    }

    // Queue granular record for persistence rather than serializing all queries
    desktopPersistenceClient.queueDirtyRecord('queryCache', key, { data, timestamp: now })
  },

  get: <T>(key: string, maxAge = DEFAULT_MAX_AGE): T | undefined => {
    const entry = get().cache[key]
    if (!entry) {
      // Check in-memory desktop persistence mirror
      const fromClient = desktopPersistenceClient.peekQuery(key) as { data: unknown; timestamp: number } | null
      if (fromClient && Number.isFinite(fromClient.timestamp) && Date.now() - fromClient.timestamp <= Math.min(maxAge, HARD_MAX_AGE)) {
        return fromClient.data as T
      }
      return undefined
    }

    const effectiveMaxAge = Math.min(maxAge, HARD_MAX_AGE)
    if (Date.now() - entry.timestamp > effectiveMaxAge) {
      return undefined
    }

    return entry.data as T
  },

  clear: (key?: string) => {
    if (key) {
      set((state) => {
        const { [key]: _removed, ...rest } = state.cache
        return { cache: rest }
      })
      desktopPersistenceClient.deleteRecord('queryCache', key)
    } else {
      const keys = new Set([
        ...Object.keys(get().cache),
        ...desktopPersistenceClient.entries('queryCache').map(record => record.key),
      ])
      for (const cacheKey of keys) desktopPersistenceClient.deleteRecord('queryCache', cacheKey)
      set({ cache: {} })
    }
  },
}))

let queryCacheHydration: Promise<void> | null = null

export function initializeQueryCache(): Promise<void> {
  if (queryCacheHydration) return queryCacheHydration
  const attempt = (async () => {
    await desktopPersistenceClient.hydrateNamespace('queryCache')
    const restored: Record<string, { data: unknown; timestamp: number }> = {}
    for (const record of desktopPersistenceClient.entries('queryCache')) {
      const entry = record.data as { data?: unknown; timestamp?: unknown } | null
      if (!entry || typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) {
        desktopPersistenceClient.deleteRecord('queryCache', record.key)
        continue
      }
      restored[record.key] = { data: entry.data, timestamp: entry.timestamp }
    }
    const current = useQueryCache.getState().cache
    const next = pruneCache({ ...restored, ...current })
    for (const key of Object.keys(restored)) {
      if (!(key in next)) desktopPersistenceClient.deleteRecord('queryCache', key)
    }
    useQueryCache.setState({ cache: next })
  })()
  queryCacheHydration = attempt
  void attempt.then(
    () => { if (queryCacheHydration === attempt) queryCacheHydration = null },
    () => { if (queryCacheHydration === attempt) queryCacheHydration = null },
  )
  return attempt
}

export interface CachedQueryState<T> {
  data: T | undefined
  cachedData: T | undefined
  freshData: T | undefined
  hasResolved: boolean
  isRefreshing: boolean
}

function useCachedQueryEntry<T>(key: string, maxAge: number): T | undefined {
  return useQueryCache((state) => {
    const entry = state.cache[key]
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > maxAge) return undefined
    return entry.data as T
  })
}

/**
 * Hook to use cached query data with automatic cache updates.
 * Returns cached data immediately, updates when fresh data arrives.
 */
export function useCachedQueryState<T>(
  key: string,
  freshData: T | undefined,
  maxAge = DEFAULT_MAX_AGE
): CachedQueryState<T> {
  const cachedData = useCachedQueryEntry<T>(key, maxAge)

  // Update cache when fresh data arrives
  useEffect(() => {
    if (freshData !== undefined) {
      void scheduleTask(() => {
        // Use getState to avoid re-render loop
        const currentCache = useQueryCache.getState().cache[key]
        // Simple reference check is usually sufficient for Convex data
        if (currentCache?.data === freshData) return

        // Guard against high-frequency cache writes when a query returns
        // rapidly changing object references.
        if (
          currentCache &&
          Date.now() - currentCache.timestamp < MIN_CACHE_REFRESH_INTERVAL_MS
        ) {
          return
        }

        useQueryCache.getState().set(key, freshData)
      }, 'background')
    }
  }, [key, freshData])

  const hasResolved = freshData !== undefined

  return {
    data: freshData === undefined ? cachedData : freshData,
    cachedData,
    freshData,
    hasResolved,
    isRefreshing: freshData === undefined && cachedData !== undefined,
  }
}

export function useCachedQuery<T>(
  key: string,
  freshData: T | undefined,
  maxAge = DEFAULT_MAX_AGE
): T | undefined {
  return useCachedQueryState(key, freshData, maxAge).data
}
