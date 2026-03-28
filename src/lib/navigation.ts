import { useCallback } from 'react'
import { createPath, type NavigateFunction, type NavigateOptions, type To, useNavigate } from '@/lib/router'

import { parseProjectRoute } from '@/features/projects/lib/projectRoutes'
import { featureFlags } from '@/lib/featureFlags'

function runWithViewTransition(update: () => void): void {
  const documentWithTransition = document as unknown as {
    startViewTransition?: (updateCallback: () => void | Promise<void>) => { finished: Promise<void> }
  }
  if (!featureFlags.viewTransitions) {
    update()
    return
  }
  if (typeof documentWithTransition.startViewTransition !== 'function') {
    throw new Error('View Transition API is unavailable in this runtime.')
  }
  void documentWithTransition.startViewTransition(update).finished
}

function isProjectRoutePath(pathname: string | null): boolean {
  if (!pathname) return false
  const route = parseProjectRoute(pathname)
  return Boolean(route.projectId || route.slug)
}

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

function shouldSkipViewTransition(to: To | number): boolean {
  if (typeof window === 'undefined') return false
  return (
    isProjectRoutePath(window.location.pathname) ||
    isProjectRoutePath(resolveNavigationPathname(to))
  )
}

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To | number,
  options?: NavigateOptions
): void {
  if (shouldSkipViewTransition(to)) {
    if (typeof to === 'number') {
      navigate(to)
      return
    }
      navigate(to, options)
    return
  }

  runWithViewTransition(() => {
    if (typeof to === 'number') {
      navigate(to)
      return
    }
    navigate(to, options)
  })
}

export function useViewTransitionNavigate(): NavigateFunction {
  const navigate = useNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      navigateWithTransition(navigate, to, options)
    },
    [navigate]
  )
}
