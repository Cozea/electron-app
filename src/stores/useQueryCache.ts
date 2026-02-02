import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface QueryCacheState {
  cache: Record<string, { data: unknown; timestamp: number }>
  set: (key: string, data: unknown) => void
  get: <T>(key: string, maxAge?: number) => T | undefined
  clear: (key?: string) => void
}

const DEFAULT_MAX_AGE = 5 * 60 * 1000 // 5 minutes

/**
 * Simple query cache for Convex data.
 * Shows cached data immediately while fresh data loads.
 *
 * Usage:
 * ```tsx
 * const cached = useQueryCache.getState().get<Project[]>('projects-list')
 * const fresh = useQuery(api.projects.list, args)
 * const data = fresh ?? cached
 *
 * useEffect(() => {
 *   if (fresh) useQueryCache.getState().set('projects-list', fresh)
 * }, [fresh])
 * ```
 */
export const useQueryCache = create<QueryCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      set: (key: string, data: unknown) => {
        set((state) => ({
          cache: {
            ...state.cache,
            [key]: { data, timestamp: Date.now() },
          },
        }))
      },

      get: <T>(key: string, maxAge = DEFAULT_MAX_AGE): T | undefined => {
        const entry = get().cache[key]
        if (!entry) return undefined

        // Check if cache is still valid
        if (Date.now() - entry.timestamp > maxAge) {
          return undefined
        }

        return entry.data as T
      },

      clear: (key?: string) => {
        if (key) {
          set((state) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [key]: _removed, ...rest } = state.cache
            return { cache: rest }
          })
        } else {
          set({ cache: {} })
        }
      },
    }),
    {
      name: 'cozea-query-cache',
      storage: createJSONStorage(() => localStorage), // Use localStorage to persist across restarts
      partialize: (state) => ({ cache: state.cache }),
    }
  )
)

/**
 * Hook to use cached query data with automatic cache updates.
 * Returns cached data immediately, updates when fresh data arrives.
 */
export function useCachedQuery<T>(
  key: string,
  freshData: T | undefined,
  maxAge = DEFAULT_MAX_AGE
): T | undefined {
  const cached = useQueryCache((state) => {
    const entry = state.cache[key]
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > maxAge) return undefined
    return entry.data as T
  })

  // Update cache when fresh data arrives
  if (freshData !== undefined) {
    // Use getState to avoid re-render loop
    const currentCache = useQueryCache.getState().cache[key]
    if (!currentCache || currentCache.data !== freshData) {
      useQueryCache.getState().set(key, freshData)
    }
  }

  // Return fresh data if available, otherwise cached
  return freshData ?? cached
}
