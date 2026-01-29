import { useRef, useEffect, ReactNode } from 'react'
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
  const cachedRoutes = useRef<CachedRoute[]>([])
  const currentPath = location.pathname

  // Check if this path should be cached
  const shouldCache = (path: string) => {
    if (!include) return true
    return include.some(pattern => {
      if (pattern.endsWith('*')) {
        return path.startsWith(pattern.slice(0, -1))
      }
      return path === pattern
    })
  }

  // Update cached routes
  useEffect(() => {
    if (!shouldCache(currentPath)) return

    const existingIndex = cachedRoutes.current.findIndex(r => r.path === currentPath)

    if (existingIndex === -1) {
      // Add new route to cache
      cachedRoutes.current = [
        { path: currentPath, element: children },
        ...cachedRoutes.current.slice(0, maxCached - 1)
      ]
    } else {
      // Update existing route and move to front
      cachedRoutes.current[existingIndex].element = children
      const [route] = cachedRoutes.current.splice(existingIndex, 1)
      cachedRoutes.current.unshift(route)
    }
  }, [currentPath, children, maxCached])

  // If current path shouldn't be cached, just render normally
  if (!shouldCache(currentPath)) {
    return <>{children}</>
  }

  // Render all cached routes, showing only the active one
  return (
    <>
      {cachedRoutes.current.map(route => (
        <div
          key={route.path}
          style={{
            display: route.path === currentPath ? 'contents' : 'none',
          }}
        >
          {route.element}
        </div>
      ))}
      {/* Render current if not yet cached */}
      {!cachedRoutes.current.some(r => r.path === currentPath) && children}
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
