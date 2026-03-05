import { useCallback } from 'react'
import { type NavigateOptions, type NavigateFunction, type To, useNavigate } from 'react-router-dom'

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

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To | number,
  options?: NavigateOptions
): void {
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
