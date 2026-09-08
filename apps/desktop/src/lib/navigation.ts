import { startTransition, useCallback } from 'react'
import { createPath, type NavigateFunction, type NavigateOptions, type To, useNavigate } from '@/lib/router'

import { parseProjectRoute } from '@/contexts/project/projectRoutes'
import { warmNavigationDestination } from '@/lib/navigationWarmup'
import { beginLocalNavigation, navigationSurface } from '@/lib/performance/localNavigation'
import { beginProjectSwitch } from '@/lib/performance/projectSwitchMarks'

function resolveNavigationPathname(to: To | number): string | null {
  if (typeof window === 'undefined') return null
  if (typeof to === 'number') return window.location.pathname

  const target = typeof to === 'string' ? to : createPath(to)

  try {
    return new URL(target, window.location.href).pathname
  } catch {
    return null
  }
}

function projectRouteIdentity(pathname: string | null): string | null {
  if (!pathname) return null
  const route = parseProjectRoute(pathname)
  return route.projectId || route.slug || null
}

function maybeBeginProjectSwitch(to: To | number): void {
  if (typeof window === 'undefined') return
  const fromId = projectRouteIdentity(window.location.pathname)
  const toId = projectRouteIdentity(resolveNavigationPathname(to))
  if (!toId || fromId === toId) return
  beginProjectSwitch({ from: fromId, to: toId })
}

function performNavigation(
  navigate: NavigateFunction,
  to: To | number,
  options?: NavigateOptions
): void | Promise<void> {
  if (typeof to === 'number') {
    return navigate(to)
  }
  return navigate(to, options)
}

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To | number,
  options?: NavigateOptions
): void | Promise<void> {
  maybeBeginProjectSwitch(to)

  const pathname = resolveNavigationPathname(to)
  if (pathname) {
    warmNavigationDestination(pathname)
    const surface = navigationSurface(pathname)
    if (surface) beginLocalNavigation(surface)
  }
  return performNavigation(navigate, to, options)
}

export function useViewTransitionNavigate(): NavigateFunction {
  const navigate = useNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      let result: void | Promise<void> = undefined
      startTransition(() => {
        result = navigateWithTransition(navigate, to, options)
      })
      return result
    },
    [navigate]
  )
}
