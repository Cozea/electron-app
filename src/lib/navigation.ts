import { useCallback } from 'react'
import { createPath, type NavigateFunction, type NavigateOptions, type To, useNavigate } from '@/lib/router'

import { parseProjectRoute } from '@/features/projects/lib/projectRoutes'
import { featureFlags } from '@/lib/featureFlags'

interface ViewTransitionHandle {
  finished: Promise<void>
  skipTransition?: () => void
}

// Crossfades longer than this are stuck (suspended route content or a blocked
// main thread), and a stuck transition paints the old page's screenshot over
// the live page — every element doubled until it resolves. Jump to the end
// state instead.
const VIEW_TRANSITION_WATCHDOG_MS = 400

let activeViewTransition: ViewTransitionHandle | null = null

function runWithViewTransition(update: () => void | Promise<void>): void {
  const documentWithTransition = document as unknown as {
    startViewTransition?: (updateCallback: () => void | Promise<void>) => ViewTransitionHandle
  }
  if (!featureFlags.viewTransitions) {
    void update()
    return
  }
  if (typeof documentWithTransition.startViewTransition !== 'function') {
    throw new Error('View Transition API is unavailable in this runtime.')
  }
  // Never stack crossfades: a second navigation while one is animating mixes
  // three UI states on screen. Apply the update directly instead.
  if (activeViewTransition) {
    activeViewTransition.skipTransition?.()
    void update()
    return
  }

  // Await the router transition plus one macrotask before the new-state
  // capture, so React has committed the destination route. (Not rAF: frames
  // are suppressed while a view transition captures, timers are not.)
  const transition = documentWithTransition.startViewTransition(async () => {
    await update()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
  activeViewTransition = transition

  const release = () => {
    if (activeViewTransition === transition) {
      activeViewTransition = null
    }
  }
  transition.finished.then(release, release)

  window.setTimeout(() => {
    if (activeViewTransition === transition) {
      try {
        transition.skipTransition?.()
      } catch {
        // Already finished or skipped.
      }
      release()
    }
  }, VIEW_TRANSITION_WATCHDOG_MS)
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
      return navigate(to)
    }
    return navigate(to, options)
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
