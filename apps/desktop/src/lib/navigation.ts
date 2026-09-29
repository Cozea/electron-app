import { startTransition, useCallback } from 'react'
import { createPath, type NavigateFunction, type NavigateOptions, type To, useNavigate } from '@/lib/router'

import { destinationHref, type Destination } from '@/lib/destinations'
import { warmNavigationDestination } from '@/lib/navigationWarmup'

function resolveNavigationPathname(to: To | number): string | null {
  if (typeof window === 'undefined' || typeof to === 'number') return null
  const target = typeof to === 'string' ? to : createPath(to)
  try {
    return new URL(target, window.location.href).pathname
  } catch {
    return null
  }
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
  const pathname = resolveNavigationPathname(to)
  if (pathname) warmNavigationDestination(pathname)
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

/**
 * Navigate to a screen described as data. Prefer this everywhere; the string
 * form (useViewTransitionNavigate) remains for hrefs that arrive from outside
 * the app's own code — deep links, persisted task links.
 */
export function useNavigateTo(): (destination: Destination, options?: NavigateOptions) => void | Promise<void> {
  const navigate = useViewTransitionNavigate()
  return useCallback(
    (destination: Destination, options?: NavigateOptions) => navigate(destinationHref(destination), options),
    [navigate]
  )
}
