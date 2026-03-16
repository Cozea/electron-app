import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface CachedRoute {
  path: string
  element: ReactNode
}

interface KeepAliveProps {
  children: ReactNode
  /** Routes to keep alive (by path pattern). If not specified, keeps all visited routes. */
  include?: string[]
  /** Maximum number of cached routes (default: 10) */
  maxCached?: number
}

/**
 * KeepAlive wrapper that prevents route components from unmounting.
 * Instead of unmounting, it hides inactive routes with display: none.
 * This preserves component state (scroll position, form inputs, etc.)
 */
export function KeepAlive({ children, include, maxCached = 10 }: KeepAliveProps) {
  const location = useLocation()
  const [cachedRoutes, setCachedRoutes] = useState<CachedRoute[]>([])
  const [lastPath, setLastPath] = useState(location.pathname)
  const currentPath = location.pathname

  // Check if this path should be cached
  const shouldCache = useCallback((path: string) => {
    if (!include) return true
    return include.some(pattern => {
      if (pattern.endsWith('*')) {
        return path.startsWith(pattern.slice(0, -1))
      }
      return path === pattern
    })
  }, [include])

  // Update cached routes safely during render
  if (currentPath !== lastPath) {
    setLastPath(currentPath)
    if (shouldCache(currentPath)) {
      setCachedRoutes(prev => {
        const existingIndex = prev.findIndex(r => r.path === currentPath)

        if (existingIndex === -1) {
          // Add new route to cache
          return [
            { path: currentPath, element: children },
            ...prev.slice(0, maxCached - 1)
          ]
        } else {
          // Update existing route and move to front
          const next = [...prev]
          next[existingIndex] = { path: currentPath, element: children }
          const [route] = next.splice(existingIndex, 1)
          next.unshift(route)
          return next
        }
      })
    }
  }

  // Update children for the active cached route if they change while path is the same
  // We do this inside the render loop by rendering the new children instead of the cached ones
  // We don't strictly need to mutate the cache for the active route because it will
  // be updated in the cache the next time the path changes.

  // If current path shouldn't be cached, just render normally
  if (!shouldCache(currentPath)) {
    return <>{children}</>
  }

  // Render all cached routes, showing only the active one
  return (
    <>
      {cachedRoutes.map(route => (
        <div
          key={route.path}
          style={{
            display: route.path === currentPath ? 'contents' : 'none',
          }}
        >
          {route.path === currentPath ? children : route.element}
        </div>
      ))}
      {/* Render current if not yet cached */}
      {!cachedRoutes.some(r => r.path === currentPath) && children}
    </>
  )
}

/**
 * Hook to check if a route is currently cached (for debugging)
 */
export function useIsRouteActive() {
  const location = useLocation()
  return location.pathname
}
